export interface FileGlyphInfo {
  icon: string
  label: string
}

export function getFileGlyph(path: string): FileGlyphInfo {
  if (!path) return { icon: '📄', label: 'File' }
  const basename = path.split(/[/\\]/u).pop() ?? path
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

export function markdownFilePath(href: string): string | undefined {
  const value = href.trim()
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

export type DshFileCategory = 'image' | 'code' | 'markdown' | 'excel' | 'pdf' | 'ppt' | 'word' | 'other'

export type DshLinkIconKind = 'image' | 'code' | 'document' | 'other'

export interface DshCategoryTheme {
  category: DshFileCategory
  color: string
  bgTint: string
  label: string
}

export function classifyDshFileType(path: string): DshFileCategory {
  if (!path) return 'other'
  const basename = path.split(/[/\\]/u).pop()?.toLowerCase() ?? ''
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
  const cat = classifyDshFileType(path)
  if (cat === 'image') return 'image'
  if (cat === 'code') return 'code'
  if (['pdf', 'excel', 'ppt', 'word'].includes(cat)) return 'document'
  return 'other'
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
