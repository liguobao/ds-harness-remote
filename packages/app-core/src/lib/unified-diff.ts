export type DiffLineKind = 'add' | 'del' | 'context' | 'meta'

export interface ParsedDiffLine {
  kind: DiffLineKind
  content: string
  oldLine?: number
  newLine?: number
}

export interface ParsedDiffHunk {
  header: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  context?: string
  lines: ParsedDiffLine[]
}

export interface ParsedDiffFile {
  path: string
  oldPath?: string
  newPath?: string
  isBinary: boolean
  isNew: boolean
  isDeleted: boolean
  isRenamed: boolean
  additions: number
  deletions: number
  hunks: ParsedDiffHunk[]
}

export interface DiffLineRange {
  start: number
  end: number
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/
const COMBINED_HUNK_HEADER_RE = /^(@{3,}) ((?:-\d+(?:,\d+)? )+)\+(\d+)(?:,(\d+))? \1(.*)$/
const BINARY_FILES_RE = /^Binary files (.+) and (.+) differ$/

function readQuotedToken(raw: string, start: number): { token: string; nextIndex: number } | undefined {
  if (raw[start] !== '"') return undefined
  let index = start + 1
  while (index < raw.length) {
    const ch = raw[index]
    if (ch === '\\') {
      index += 2
      continue
    }
    if (ch === '"') {
      return { token: raw.slice(start, index + 1), nextIndex: index + 1 }
    }
    index += 1
  }
  return undefined
}

function unquoteGitPath(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\(["\\tnr])/g, (_, ch: string) => {
        if (ch === 't') return '\t'
        if (ch === 'n') return '\n'
        if (ch === 'r') return '\r'
        return ch
      })
  }
  return trimmed
}

function stripDiffPrefix(raw: string, prefix: 'a/' | 'b/'): string | undefined {
  const unquoted = unquoteGitPath(raw)
  if (unquoted === '/dev/null') return undefined
  if (unquoted.startsWith(prefix)) return unquoted.slice(prefix.length)
  if (unquoted.startsWith('a/') || unquoted.startsWith('b/')) return unquoted.slice(2)
  return unquoted
}

function parseDiffGitLine(line: string): { oldPath?: string; newPath?: string } {
  const rest = line.slice('diff --git '.length)
  if (rest.startsWith('"')) {
    const first = readQuotedToken(rest, 0)
    if (first !== undefined && rest[first.nextIndex] === ' ') {
      const secondRaw = rest.slice(first.nextIndex + 1)
      return {
        oldPath: stripDiffPrefix(first.token, 'a/'),
        newPath: stripDiffPrefix(secondRaw, 'b/'),
      }
    }
  }
  if (rest.endsWith('"')) {
    let searchFrom = rest.length - 1
    while (searchFrom > 0) {
      const split = rest.lastIndexOf(' "b/', searchFrom)
      if (split < 0) break
      const second = readQuotedToken(rest, split + 1)
      if (second !== undefined && second.nextIndex === rest.length) {
        return {
          oldPath: stripDiffPrefix(rest.slice(0, split), 'a/'),
          newPath: stripDiffPrefix(second.token, 'b/'),
        }
      }
      searchFrom = split - 1
    }
  }
  if (rest.startsWith('a/') && (rest.length - 1) % 2 === 0) {
    const half = (rest.length - 1) / 2
    if (rest[half] === ' ' && rest.slice(half + 1, half + 3) === 'b/' && rest.slice(2, half) === rest.slice(half + 3)) {
      const same = rest.slice(2, half)
      return { oldPath: same, newPath: same }
    }
  }
  const plain = /^a\/(.+?) b\/(.+)$/.exec(rest)
  if (plain !== null && plain[1] !== undefined && plain[2] !== undefined) {
    return { oldPath: plain[1], newPath: plain[2] }
  }
  return {}
}

function parseHeaderPath(line: string, marker: '--- ' | '+++ '): { path?: string; isDevNull: boolean } {
  let rest = line.slice(marker.length)
  if (rest.startsWith('"')) {
    const quoted = readQuotedToken(rest, 0)
    if (quoted !== undefined) {
      const unquoted = unquoteGitPath(quoted.token)
      if (unquoted === '/dev/null') return { path: undefined, isDevNull: true }
      const prefix = marker === '--- ' ? 'a/' : 'b/'
      return { path: stripDiffPrefix(unquoted, prefix), isDevNull: false }
    }
  }
  const tabIndex = rest.indexOf('\t')
  if (tabIndex >= 0) rest = rest.slice(0, tabIndex)
  const unquoted = unquoteGitPath(rest)
  if (unquoted === '/dev/null') {
    return { path: undefined, isDevNull: true }
  }
  const prefix = marker === '--- ' ? 'a/' : 'b/'
  return { path: stripDiffPrefix(unquoted, prefix), isDevNull: false }
}

function createFileRecord(oldPath?: string, newPath?: string): ParsedDiffFile {
  const path = newPath ?? oldPath ?? ''
  return {
    path,
    ...(oldPath === undefined ? {} : { oldPath }),
    ...(newPath === undefined ? {} : { newPath }),
    isBinary: false,
    isNew: false,
    isDeleted: false,
    isRenamed: oldPath !== undefined && newPath !== undefined && oldPath !== newPath,
    additions: 0,
    deletions: 0,
    hunks: [],
  }
}

/**
 * Parse a standard Git/unified diff into structured files, hunks, and numbered lines.
 * Tolerates multi-file diffs, renames, binary notices, no-newline markers, and truncated tails.
 */
export function parseUnifiedDiff(raw: string): ParsedDiffFile[] {
  if (raw.length === 0) return []
  const normalized = raw.replace(/\r\n/g, '\n')
  const rawLines = normalized.split('\n')
  if (normalized.endsWith('\n')) {
    rawLines.pop()
  }

  const files: ParsedDiffFile[] = []
  let currentFile: ParsedDiffFile | undefined
  let currentHunk: ParsedDiffHunk | undefined
  let combinedPrefixWidth = 0
  let sawPlusHeader = false
  let inBinaryPatch = false
  let curOldLine = 0
  let curNewLine = 0
  let remOld = 0
  let remNew = 0

  const startFile = (oldPath?: string, newPath?: string): ParsedDiffFile => {
    const next = createFileRecord(oldPath, newPath)
    files.push(next)
    currentFile = next
    currentHunk = undefined
    combinedPrefixWidth = 0
    sawPlusHeader = false
    inBinaryPatch = false
    remOld = 0
    remNew = 0
    return next
  }

  const syncFileMeta = (file: ParsedDiffFile): void => {
    file.path = file.newPath ?? file.oldPath ?? file.path
    file.isRenamed = file.isRenamed || (
      !file.isNew
      && !file.isDeleted
      && file.oldPath !== undefined
      && file.newPath !== undefined
      && file.oldPath !== file.newPath
    )
  }

  for (const line of rawLines) {
    if (line.startsWith('diff --git ')) {
      const { oldPath, newPath } = parseDiffGitLine(line)
      startFile(oldPath, newPath)
      continue
    }

    if (line.startsWith('diff --cc ') || line.startsWith('diff --combined ')) {
      const prefixLen = line.startsWith('diff --cc ') ? 'diff --cc '.length : 'diff --combined '.length
      const path = unquoteGitPath(line.slice(prefixLen))
      startFile(path, path)
      continue
    }

    const hunkMatch = HUNK_HEADER_RE.exec(line)
    if (hunkMatch !== null && hunkMatch[1] !== undefined && hunkMatch[3] !== undefined) {
      const file = currentFile ?? startFile()
      const oldStart = Number.parseInt(hunkMatch[1], 10)
      const oldCount = hunkMatch[2] === undefined ? 1 : Number.parseInt(hunkMatch[2], 10)
      const newStart = Number.parseInt(hunkMatch[3], 10)
      const newCount = hunkMatch[4] === undefined ? 1 : Number.parseInt(hunkMatch[4], 10)
      const rawContext = (hunkMatch[5] ?? '').trim()
      const hunk: ParsedDiffHunk = {
        header: line,
        oldStart,
        oldCount,
        newStart,
        newCount,
        ...(rawContext.length > 0 ? { context: rawContext } : {}),
        lines: [],
      }
      file.hunks.push(hunk)
      currentHunk = hunk
      combinedPrefixWidth = 0
      inBinaryPatch = false
      curOldLine = oldStart
      curNewLine = newStart
      remOld = oldCount
      remNew = newCount
      continue
    }

    const combinedMatch = COMBINED_HUNK_HEADER_RE.exec(line)
    if (
      combinedMatch !== null
      && combinedMatch[1] !== undefined
      && combinedMatch[2] !== undefined
      && combinedMatch[3] !== undefined
    ) {
      const file = currentFile ?? startFile()
      const firstOldMatch = /^-(\d+)(?:,(\d+))?/.exec(combinedMatch[2])
      const oldStart = firstOldMatch?.[1] !== undefined ? Number.parseInt(firstOldMatch[1], 10) : 0
      const oldCount = firstOldMatch?.[2] !== undefined ? Number.parseInt(firstOldMatch[2], 10) : (oldStart > 0 ? 1 : 0)
      const newStart = Number.parseInt(combinedMatch[3], 10)
      const newCount = combinedMatch[4] === undefined ? 1 : Number.parseInt(combinedMatch[4], 10)
      const rawContext = (combinedMatch[5] ?? '').trim()
      const hunk: ParsedDiffHunk = {
        header: line,
        oldStart,
        oldCount,
        newStart,
        newCount,
        ...(rawContext.length > 0 ? { context: rawContext } : {}),
        lines: [],
      }
      file.hunks.push(hunk)
      currentHunk = hunk
      combinedPrefixWidth = combinedMatch[1].length - 1
      inBinaryPatch = false
      curOldLine = oldStart
      curNewLine = newStart
      remOld = oldCount
      remNew = newCount
      continue
    }

    if (currentHunk !== undefined && currentFile !== undefined) {
      const atHunkBoundary = (combinedPrefixWidth > 0 ? remNew === 0 : remOld === 0 && remNew === 0) && (
        line.startsWith('--- ')
        || line.startsWith('+++ ')
        || BINARY_FILES_RE.test(line)
        || line === 'GIT binary patch'
      )
      if (!atHunkBoundary) {
        if (combinedPrefixWidth >= 2) {
          if (line.startsWith('\\')) {
            currentHunk.lines.push({ kind: 'meta', content: line })
            continue
          }
          if (line === '' && remNew > 0) {
            currentHunk.lines.push({
              kind: 'context',
              content: '',
              oldLine: curOldLine,
              newLine: curNewLine,
            })
            curOldLine += 1
            curNewLine += 1
            remNew = Math.max(0, remNew - 1)
            continue
          }
          if (line.length >= combinedPrefixWidth) {
            const prefix = line.slice(0, combinedPrefixWidth)
            if (/^[ +-]+$/.test(prefix)) {
              const content = line.slice(combinedPrefixWidth)
              if (prefix.includes('+')) {
                currentHunk.lines.push({
                  kind: 'add',
                  content,
                  newLine: curNewLine,
                })
                curNewLine += 1
                remNew = Math.max(0, remNew - 1)
                currentFile.additions += 1
                continue
              }
              if (prefix.includes('-')) {
                const parentOld = prefix[0] === '-' ? curOldLine : undefined
                if (prefix[0] === '-') curOldLine += 1
                currentHunk.lines.push({
                  kind: 'del',
                  content,
                  ...(parentOld === undefined ? {} : { oldLine: parentOld }),
                })
                currentFile.deletions += 1
                continue
              }
              currentHunk.lines.push({
                kind: 'context',
                content,
                oldLine: curOldLine,
                newLine: curNewLine,
              })
              curOldLine += 1
              curNewLine += 1
              remNew = Math.max(0, remNew - 1)
              continue
            }
          }
        } else {
          if (line.startsWith('+')) {
            currentHunk.lines.push({
              kind: 'add',
              content: line.slice(1),
              newLine: curNewLine,
            })
            curNewLine += 1
            remNew = Math.max(0, remNew - 1)
            currentFile.additions += 1
            continue
          }
          if (line.startsWith('-')) {
            currentHunk.lines.push({
              kind: 'del',
              content: line.slice(1),
              oldLine: curOldLine,
            })
            curOldLine += 1
            remOld = Math.max(0, remOld - 1)
            currentFile.deletions += 1
            continue
          }
          if (line.startsWith(' ')) {
            currentHunk.lines.push({
              kind: 'context',
              content: line.slice(1),
              oldLine: curOldLine,
              newLine: curNewLine,
            })
            curOldLine += 1
            curNewLine += 1
            remOld = Math.max(0, remOld - 1)
            remNew = Math.max(0, remNew - 1)
            continue
          }
          if (line.startsWith('\\')) {
            currentHunk.lines.push({
              kind: 'meta',
              content: line,
            })
            continue
          }
          if (line === '' && (remOld > 0 || remNew > 0)) {
            currentHunk.lines.push({
              kind: 'context',
              content: '',
              oldLine: curOldLine,
              newLine: curNewLine,
            })
            curOldLine += 1
            curNewLine += 1
            remOld = Math.max(0, remOld - 1)
            remNew = Math.max(0, remNew - 1)
            continue
          }
        }
      }
      currentHunk = undefined
      combinedPrefixWidth = 0
    }

    if (line.startsWith('--- ')) {
      const parsed = parseHeaderPath(line, '--- ')
      const file = currentFile === undefined || currentFile.hunks.length > 0 || sawPlusHeader || currentFile.isBinary
        ? startFile()
        : currentFile
      inBinaryPatch = false
      if (parsed.isDevNull) {
        file.isNew = true
        delete file.oldPath
      } else if (parsed.path !== undefined) {
        file.oldPath = parsed.path
      }
      syncFileMeta(file)
      continue
    }

    const binaryMatch = BINARY_FILES_RE.exec(line)
    if (binaryMatch !== null && binaryMatch[1] !== undefined && binaryMatch[2] !== undefined) {
      const oldPath = stripDiffPrefix(binaryMatch[1], 'a/')
      const newPath = stripDiffPrefix(binaryMatch[2], 'b/')
      const file = currentFile === undefined || currentFile.isBinary || currentFile.hunks.length > 0 || sawPlusHeader
        ? startFile(oldPath, newPath)
        : currentFile
      inBinaryPatch = false
      if (oldPath === undefined) file.isNew = true
      else if (file.oldPath === undefined) file.oldPath = oldPath
      if (newPath === undefined) file.isDeleted = true
      else if (file.newPath === undefined) file.newPath = newPath
      file.isBinary = true
      syncFileMeta(file)
      continue
    }

    if (line === 'GIT binary patch') {
      const file = currentFile ?? startFile()
      file.isBinary = true
      inBinaryPatch = true
      continue
    }

    if (inBinaryPatch) {
      continue
    }

    if (line.startsWith('new file mode ')) {
      const file = currentFile ?? startFile()
      file.isNew = true
      continue
    }

    if (line.startsWith('deleted file mode ')) {
      const file = currentFile ?? startFile()
      file.isDeleted = true
      continue
    }

    if (line.startsWith('rename from ')) {
      const file = currentFile ?? startFile()
      file.oldPath = unquoteGitPath(line.slice('rename from '.length))
      file.isRenamed = true
      syncFileMeta(file)
      continue
    }

    if (line.startsWith('rename to ')) {
      const file = currentFile ?? startFile()
      file.newPath = unquoteGitPath(line.slice('rename to '.length))
      file.isRenamed = true
      syncFileMeta(file)
      continue
    }

    if (line.startsWith('+++ ')) {
      const parsed = parseHeaderPath(line, '+++ ')
      const file = currentFile ?? startFile()
      sawPlusHeader = true
      if (parsed.isDevNull) {
        file.isDeleted = true
        delete file.newPath
      } else if (parsed.path !== undefined) {
        file.newPath = parsed.path
      }
      syncFileMeta(file)
      continue
    }
  }

  return files
}

/**
 * Derive the default quote line range for a hunk:
 * 1. Span of all added (`+`) lines in the new file.
 * 2. Fallback to the hunk's new-file range when `newCount > 0`.
 * 3. For pure deletions (`newCount === 0`), anchor at `newStart` (when file still exists and `newStart > 0`),
 *    or the deleted old-file range when the entire file was deleted.
 */
export function hunkQuoteRange(hunk: ParsedDiffHunk, fileDeleted = false): DiffLineRange | undefined {
  let minAdd: number | undefined
  let maxAdd: number | undefined
  for (const line of hunk.lines) {
    if (line.kind !== 'add' || line.newLine === undefined || line.newLine <= 0) continue
    minAdd = minAdd === undefined ? line.newLine : Math.min(minAdd, line.newLine)
    maxAdd = maxAdd === undefined ? line.newLine : Math.max(maxAdd, line.newLine)
  }
  if (minAdd !== undefined && maxAdd !== undefined) {
    return { start: minAdd, end: maxAdd }
  }
  if (hunk.newCount > 0 && hunk.newStart > 0) {
    return { start: hunk.newStart, end: hunk.newStart + hunk.newCount - 1 }
  }
  if (fileDeleted) {
    if (hunk.oldCount > 0 && hunk.oldStart > 0) {
      return { start: hunk.oldStart, end: hunk.oldStart + hunk.oldCount - 1 }
    }
    return undefined
  }
  if (hunk.newStart > 0) {
    return { start: hunk.newStart, end: hunk.newStart }
  }
  return undefined
}

/**
 * Format a file path and optional line range as `path`, `path:L42`, or `path:L42-L58`.
 * Paths containing whitespace are wrapped in backticks so they stay unambiguous in prompts.
 */
export function formatDiffReference(path: string, range?: DiffLineRange): string {
  let suffix = ''
  if (range !== undefined && Number.isInteger(range.start) && Number.isInteger(range.end)) {
    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)
    if (start > 0) {
      suffix = start === end ? `:L${start}` : `:L${start}-L${end}`
    }
  }
  const ref = `${path}${suffix}`
  return /\s/u.test(path) ? `\`${ref}\`` : ref
}

/**
 * Insert a diff reference into the chat draft.
 * Empty/whitespace-only drafts use `promptTemplate`; existing drafts append `${reference} ` cleanly.
 */
export function applyChangeQuoteDraft(
  currentDraft: string,
  reference: string,
  promptTemplate: (ref: string) => string,
): { draft: string; cursor: number } {
  if (reference.length === 0) {
    return { draft: currentDraft, cursor: currentDraft.length }
  }
  if (currentDraft.trim().length === 0) {
    const draft = promptTemplate(reference)
    return { draft, cursor: draft.length }
  }
  const separator = /\s$/u.test(currentDraft) ? '' : ' '
  const draft = `${currentDraft}${separator}${reference} `
  return { draft, cursor: draft.length }
}
