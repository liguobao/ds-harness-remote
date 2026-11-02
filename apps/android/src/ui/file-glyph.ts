export interface FileGlyphInfo {
  icon: string
  label: string
}

export function getFileGlyph(path: string): FileGlyphInfo {
  if (!path) return { icon: '📄', label: 'File' }
  const basename = path.split(/[/\\\\]/u).pop() ?? path
  const dot = basename.lastIndexOf('.')
  const ext = dot >= 0 ? basename.slice(dot + 1).toLowerCase() : ''
  if (!ext) {
    if (/^(?:dockerfile|makefile|procfile)$/iu.test(basename)) {
      return { icon: '⚙️', label: 'Config' }
    }
    return { icon: '📄', label: 'File' }
  }
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico'].includes(ext)) {
    return { icon: '🖼️', label: 'Image' }
  }
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'sh', 'bash', 'zsh'].includes(ext)) {
    return { icon: '💻', label: 'Code' }
  }
  if (['json', 'yaml', 'yml', 'toml', 'env', 'xml', 'ini'].includes(ext)) {
    return { icon: '⚙️', label: 'Config' }
  }
  if (['md', 'txt', 'pdf', 'csv', 'doc', 'docx', 'xls', 'xlsx'].includes(ext)) {
    return { icon: '📄', label: 'Document' }
  }
  return { icon: '📄', label: ext.toUpperCase() }
}

export interface DshParsedFileLink {
  path: string
  line?: number
}

/**
 * 1:1 Official DeepSeek Harness desktop `ow(e)` implementation:
 * Resolves local file targets, Windows drive letters (D:/...), angle-bracket paths (<...>),
 * and line anchors (#L24, #L1-L7).
 */
export function parseDshFileLink(rawHref: string): DshParsedFileLink | undefined {
  if (typeof rawHref !== 'string') return undefined
  let e = rawHref.trim()
  if (!e) return undefined

  // 1. Angle bracket unwrap (<docs/my file.md>)
  if (e.startsWith('<') && e.endsWith('>')) {
    e = e.slice(1, -1).trim()
  }

  // 2. Separate '#' anchor from path
  const hashIndex = e.indexOf('#')
  const rawPath = hashIndex < 0 ? e : e.slice(0, hashIndex)

  // 3. Decode URI components
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return undefined
  }

  // 4. Strip leading './' and '.\\' iteratively
  let cleanPath = decoded
  while (/^\.[/\\]/.test(cleanPath)) {
    cleanPath = cleanPath.slice(2)
  }

  // 5. Strict safety constraints:
  // - Cannot be empty
  // - Cannot start with '/' or '\\' (absolute POSIX/UNC paths forbidden, Windows drive letters C:/ are allowed)
  // - Cannot contain '?' (query parameters are strictly forbidden on local files, even if %3F encoded)
  // - Cannot contain control characters
  // - Cannot start with UNC path: // or \\
  // - Cannot contain path traversal: /(?:^|[/\\])\.\.(?:[/\\]|$)/
  // - Cannot start with URI scheme (except Windows drive letters e.g. C:/ or D:\)
  if (
    cleanPath.length === 0 ||
    cleanPath.startsWith('/') ||
    cleanPath.startsWith('\\') ||
    cleanPath.includes('?') ||
    /[\u0000-\u001f\u007f]/.test(cleanPath) ||
    /^[\\/]{2}/.test(cleanPath) ||
    /(?:^|[/\\])\.\.(?:[/\\]|$)/.test(cleanPath) ||
    (/^[a-z][a-z\d+.-]*:/i.test(cleanPath) && !/^[a-zA-Z]:[\\/]/i.test(cleanPath))
  ) {
    return undefined
  }

  // 6. Anchor validation (#L<start> or #L<start>-L<end>)
  if (hashIndex < 0) return { path: cleanPath }

  const anchor = e.slice(hashIndex + 1)
  const match = /^L([1-9]\d*)(?:-L([1-9]\d*))?$/i.exec(anchor)
  if (match === null) return { path: cleanPath }

  const startLine = Number(match[1])
  const endLine = match[2] === undefined ? startLine : Number(match[2])
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || endLine < startLine) {
    return { path: cleanPath }
  }

  return { path: cleanPath, line: startLine }
}

export function markdownFilePath(href: string): string | undefined {
  const value = href?.trim() ?? ''
  if (value.length === 0 || value.startsWith('#') || /^(?:https?|mailto|data|javascript|dsh-session):/iu.test(value)) return undefined
  if (value.startsWith('file://')) {
    try {
      const url = new URL(value)
      if (url.protocol !== 'file:') return undefined
      const path = decodeURIComponent(url.pathname)
      return path.length > 0 ? ( /^\/[A-Za-z]:\//u.test(path) ? path.slice(1) : path ) : undefined
    } catch { return undefined }
  }
  try {
    let path = decodeURIComponent(value.split(/[?#]/u, 1)[0] ?? '')
    if (path.startsWith('./')) path = path.slice(2)
    return path.length > 0 && !path.startsWith('//') ? path : undefined
  } catch { return undefined }
}

/**
 * Strict workspace target resolver:
 * Workspace targets must be relative file paths within the workspace.
 * Rejects drive letters (even if %43%3A encoded, wrapped in <>, or with ./) and absolute paths.
 */
export function parseWorkspaceTarget(rawHref: string): DshParsedFileLink | undefined {
  const parsed = parseDshFileLink(rawHref)
  if (!parsed) return undefined

  // Strip all leading './' and '.\\' segments iteratively
  let p = parsed.path
  while (/^\.[/\\]/.test(p)) {
    p = p.slice(2)
  }

  // Workspace target MUST be a clean relative path:
  // 1. Cannot be empty
  // 2. Cannot start with '/' or '\\' (absolute path)
  // 3. Cannot contain Windows drive letters (/^[a-zA-Z]:/ or /[a-zA-Z]:/)
  // 4. Cannot contain any URI schemes (e.g. javascript:, https:, file:)
  // 5. Cannot contain path traversal
  if (
    p.length === 0 ||
    p.startsWith('/') ||
    p.startsWith('\\') ||
    /^[a-zA-Z]:/.test(p) ||
    /(?:^|[/\\])[a-zA-Z]:/.test(p) ||
    /^[a-z][a-z\d+.-]*:/i.test(p) ||
    /(?:^|[/\\])\.\.(?:[/\\]|$)/.test(p)
  ) {
    return undefined
  }

  return { path: p, line: parsed.line }
}

export type DshFileCategory = 'image' | 'code' | 'markdown' | 'excel' | 'pdf' | 'ppt' | 'word' | 'other'

export type DshLinkIconKind =
  | 'image'
  | 'code'
  | 'document'
  | 'folder'
  | 'other'
  | 'github'
  | 'google'
  | 'mdn'
  | 'globe'

export interface DshCategoryTheme {
  category: DshFileCategory
  color: string
  bgTint: string
  label: string
}

export function classifyDshFileType(path: string): DshFileCategory {
  if (!path) return 'other'
  const basename = path.split(/[/\\\\]/u).pop()?.toLowerCase() ?? ''
  const dot = basename.lastIndexOf('.')
  const ext = dot >= 0 ? basename.slice(dot + 1) : ''
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'bmp', 'ico', 'heic', 'heif'].includes(ext)) {
    return 'image'
  }
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'sh', 'bash', 'zsh', 'html', 'css', 'json', 'yaml', 'yml', 'toml'].includes(ext)) {
    return 'code'
  }
  if (['md', 'mdx', 'markdown'].includes(ext)) {
    return 'markdown'
  }
  if (['xls', 'xlsx', 'csv', 'tsv', 'numbers'].includes(ext)) {
    return 'excel'
  }
  if (ext === 'pdf') {
    return 'pdf'
  }
  if (['ppt', 'pptx', 'key'].includes(ext)) {
    return 'ppt'
  }
  if (['doc', 'docx', 'rtf', 'pages'].includes(ext)) {
    return 'word'
  }
  return 'other'
}

export function classifyDshLinkPath(path: string): DshLinkIconKind {
  const basename = (path ?? '').split(/[/\\\\]/u).pop()?.toLowerCase() ?? ''
  const dot = basename.lastIndexOf('.')
  const ext = dot >= 0 ? basename.slice(dot + 1) : ''

  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'bmp', 'ico', 'heic', 'heif'].includes(ext)) {
    return 'image'
  }
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'sh', 'bash', 'zsh', 'html', 'css', 'json', 'yaml', 'yml', 'toml', 'sql'].includes(ext)) {
    return 'code'
  }
  if (['md', 'mdx', 'markdown', 'txt', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'tsv', 'rtf'].includes(ext)) {
    return 'document'
  }
  if (path.endsWith('/') || path.endsWith('\\')) return 'folder'
  return 'other'
}

/**
 * 1:1 Official DeepSeek Harness desktop domain brand classifier `KA(href)`.
 * Strictly checks hostname against exact domain or subdomains.
 */
export function classifyDshWebBrand(rawUrl: string): DshLinkIconKind | undefined {
  if (typeof rawUrl !== 'string') return undefined
  let clean = rawUrl.trim()
  if (clean.startsWith('<') && clean.endsWith('>')) clean = clean.slice(1, -1).trim()
  if (/^www\./i.test(clean)) clean = `https://${clean}`

  let hostname: string
  try {
    const u = new URL(clean)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
    hostname = u.hostname.toLowerCase()
  } catch {
    return undefined
  }

  const isDomain = (target: string) => hostname === target || hostname.endsWith(`.${target}`)

  if (
    isDomain('github.com') ||
    isDomain('github.io') ||
    isDomain('raw.githubusercontent.com')
  ) {
    return 'github'
  }
  if (isDomain('google.com')) {
    return 'google'
  }
  if (isDomain('developer.mozilla.org')) {
    return 'mdn'
  }
  return 'globe'
}

export function getDshCategoryTheme(category: DshFileCategory): DshCategoryTheme {
  switch (category) {
    case 'image':
      return { category: 'image', color: 'rgb(139, 118, 246)', bgTint: 'rgba(139, 118, 246, 0.12)', label: 'Image' }
    case 'code':
      return { category: 'code', color: 'rgb(24, 96, 236)', bgTint: 'rgba(24, 96, 236, 0.12)', label: 'Code' }
    case 'markdown':
      return { category: 'markdown', color: 'rgb(24, 96, 236)', bgTint: 'rgba(24, 96, 236, 0.12)', label: 'Markdown' }
    case 'excel':
      return { category: 'excel', color: 'rgb(16, 185, 129)', bgTint: 'rgba(16, 185, 129, 0.12)', label: 'Spreadsheet' }
    case 'pdf':
      return { category: 'pdf', color: 'rgb(239, 68, 68)', bgTint: 'rgba(239, 68, 68, 0.12)', label: 'PDF' }
    case 'ppt':
      return { category: 'ppt', color: 'rgb(245, 158, 11)', bgTint: 'rgba(245, 158, 11, 0.12)', label: 'Presentation' }
    case 'word':
      return { category: 'word', color: 'rgb(59, 130, 246)', bgTint: 'rgba(59, 130, 246, 0.12)', label: 'Document' }
    default:
      return { category: 'other', color: 'rgb(148, 163, 184)', bgTint: 'rgba(148, 163, 184, 0.12)', label: 'File' }
  }
}
