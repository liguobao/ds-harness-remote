/**
 * Chat file utilities.
 *
 * Helpers for staging files selected from the device and formatting them
 * into an `<uploaded_files>` prompt block compatible with Claude-style attachments.
 */

export interface StagedFile {
  id: string
  name: string
  size: number
  mimeType?: string
  uri: string
  content: string
}

export const MAX_SINGLE_FILE_BYTES = 512 * 1024 // 512 KB
export const MAX_TOTAL_FILES_BYTES = 2 * 1024 * 1024 // 2 MB

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
