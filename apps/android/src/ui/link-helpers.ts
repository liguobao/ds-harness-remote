import { Linking } from 'react-native'
import MarkdownIt from 'markdown-it'
import { installMath } from './markdown-math'
import { markdownFilePath, classifyDshLinkPath, type DshLinkIconKind } from './file-glyph'

export { markdownFilePath, classifyDshLinkPath, type DshLinkIconKind }

export type LinkKind = 'citation' | 'external' | 'workspace' | 'session' | 'standard'

export type BlockReason = 'unsafe_protocol' | 'malformed_uri'

export interface MarkdownLinkInfo {
  kind: LinkKind
  rawHref: string
  safeHref: string | null
  displayText: string
  isBlocked: boolean
  blockReason?: BlockReason
  citationIndex?: string
  domain?: string
  workspacePath?: string
  sessionId?: string
}

export interface SanitizeResult {
  safeHref: string | null
  isBlocked: boolean
  reason?: BlockReason
  protocol?: string
}

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const ALLOWED_ALL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'dsh-session:', 'workspace:'])

const BLOCKED_PROTOCOLS = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'file:',
  'blob:',
  'intent:',
  'content:',
  'about:',
  'filesystem:',
  'jar:',
  'chrome:',
  'chrome-extension:',
])

const SCHEME_REGEX = /^([a-z][a-z0-9+.-]*):/i
const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g
const URL_SCHEME_PREFIX_REGEX = /^[a-z][a-z0-9+.-]*:\/\//i
const WWW_PREFIX_REGEX = /^www\./i
const BARE_URL_TEXT_REGEX = /^(?:https?:\/\/|www\.)\S+$/i

// 严格且安全的成对角标与锚点正则（无灾难性回溯）
const CITATION_BRACKET_REGEX = /^\[\^?(\d+)\]$/
const CITATION_CARET_REGEX = /^\^(\d+)$/
const CITATION_NAMED_REGEX = /^\[(?:来源|参考|cite|ref)\s*(?:[:：]\s*)?(\d+)\]$/iu
const CITATION_ANCHOR_REGEX = /^#(?:cite|ref|fn|footnote)[-_](\d+)$/i

function stripWrappingBrackets(href: string): string {
  const trimmed = href.trim()
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

export function getProtocol(href: string): string {
  const match = SCHEME_REGEX.exec((href ?? '').trim())
  return match ? `${match[1]!.toLowerCase()}:` : ''
}

/**
 * 严格协议白名单校验与安全清洗：
 * - 协议相对链接（以 // 开头）在处理相对路径前统一提升为 https:// 并进行完整 WHATWG 规范化
 * - 拦截危险伪协议（javascript:, data:, vbscript:, file:, blob: 等）及控制字符绕过
 * - 隐式将 www. 前缀提升为 https://
 * - 严格校验内部协议（dsh-session, workspace）载荷有效性
 */
export function sanitizeAndValidateHref(rawHref: string): SanitizeResult {
  if (typeof rawHref !== 'string') {
    return { safeHref: null, isBlocked: true, reason: 'malformed_uri' }
  }

  const cleaned = stripWrappingBrackets(rawHref).replace(CONTROL_CHARS_REGEX, '').trim()
  if (!cleaned) {
    return { safeHref: null, isBlocked: true, reason: 'malformed_uri' }
  }

  // 1. 协议相对 URL 必须在常规斜杠相对路径之前优先识别并补齐协议
  let candidate = cleaned
  if (candidate.startsWith('//')) {
    if (candidate.startsWith('///') || candidate.startsWith('//\\')) {
      return { safeHref: null, isBlocked: true, reason: 'malformed_uri' }
    }
    candidate = `https:${candidate}`
  } else if (WWW_PREFIX_REGEX.test(candidate)) {
    candidate = `https://${candidate}`
  }

  const schemeMatch = SCHEME_REGEX.exec(candidate)

  // 无协议头：相对路径、页面锚点
  if (!schemeMatch) {
    if (candidate.startsWith('#') || candidate.startsWith('/') || candidate.startsWith('./') || candidate.startsWith('../')) {
      return { safeHref: candidate, isBlocked: false }
    }
    const colonIndex = candidate.indexOf(':')
    if (colonIndex > 0) {
      return { safeHref: null, isBlocked: true, reason: 'unsafe_protocol' }
    }
    return { safeHref: candidate, isBlocked: false }
  }

  const protocol = `${schemeMatch[1]!.toLowerCase()}:`

  if (BLOCKED_PROTOCOLS.has(protocol) || !ALLOWED_ALL_PROTOCOLS.has(protocol)) {
    return { safeHref: null, isBlocked: true, reason: 'unsafe_protocol', protocol }
  }

  // 2. 内部会话协议：必须能成功解码出有效 sessionId
  if (protocol === 'dsh-session:') {
    const sessionId = decodeSessionMentionUri(candidate)
    if (!sessionId || sessionId.length === 0) {
      return { safeHref: null, isBlocked: true, reason: 'malformed_uri', protocol }
    }
    return { safeHref: candidate, isBlocked: false, protocol }
  }

  // 3. 内部工作区协议：必须是合法相对路径，拒绝 UNC、nested scheme、盘符及路径穿越
  if (protocol === 'workspace:') {
    const raw = candidate.slice('workspace:'.length).trim()
    if (
      !raw ||
      raw.startsWith('/') ||
      raw.startsWith('\\') ||
      raw.startsWith('//') ||
      raw.includes('://') ||
      /^[a-zA-Z]:/.test(raw) ||
      /(?:^|[/\\])\.\.(?:[/\\]|$)/.test(raw)
    ) {
      return { safeHref: null, isBlocked: true, reason: 'malformed_uri', protocol }
    }
    const path = markdownFilePath(candidate)
    if (
      !path ||
      path.length === 0 ||
      path.startsWith('/') ||
      path.startsWith('\\') ||
      /^[a-zA-Z]:/.test(path) ||
      /(?:^|[/\\])\.\.(?:[/\\]|$)/.test(path)
    ) {
      return { safeHref: null, isBlocked: true, reason: 'malformed_uri', protocol }
    }
    return { safeHref: candidate, isBlocked: false, protocol }
  }

  // 4. 网络协议：要求标准 // 双斜杠前缀并严格校验
  if (protocol === 'http:' || protocol === 'https:') {
    if (!/^https?:\/\//i.test(candidate)) {
      return { safeHref: null, isBlocked: true, reason: 'malformed_uri', protocol }
    }
  }

  try {
    const parsed = new URL(candidate)
    const parsedProtocol = parsed.protocol.toLowerCase()

    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsedProtocol)) {
      return { safeHref: null, isBlocked: true, reason: 'unsafe_protocol', protocol: parsedProtocol }
    }

    if ((parsedProtocol === 'http:' || parsedProtocol === 'https:') && !parsed.hostname) {
      return { safeHref: null, isBlocked: true, reason: 'malformed_uri', protocol: parsedProtocol }
    }

    return { safeHref: candidate, isBlocked: false, protocol: parsedProtocol }
  } catch {
    return { safeHref: null, isBlocked: true, reason: 'malformed_uri', protocol }
  }
}

/**
 * 判定链接是否为引用来源角标（例如 [1], [^1], ^1, [来源 1], #fn-1）：
 * - 严格成对匹配，单字母或裸数字不误判为角标，除非通过明确的 #cite-1 锚点确认；
 * - 前置长度保护（<= 32 字符），彻底消除回溯开销。
 */
export function isCitationLink(
  text: string,
  href?: string,
): { isCitation: boolean; index?: string } {
  const trimmedText = typeof text === 'string' ? text.trim() : ''

  if (trimmedText && trimmedText.length <= 32) {
    const bMatch = CITATION_BRACKET_REGEX.exec(trimmedText)
    if (bMatch && bMatch[1]) return { isCitation: true, index: bMatch[1] }

    const cMatch = CITATION_CARET_REGEX.exec(trimmedText)
    if (cMatch && cMatch[1]) return { isCitation: true, index: cMatch[1] }

    const nMatch = CITATION_NAMED_REGEX.exec(trimmedText)
    if (nMatch && nMatch[1]) return { isCitation: true, index: nMatch[1] }
  }

  const trimmedHref = typeof href === 'string' ? href.trim() : ''
  if (trimmedHref) {
    const anchorMatch = CITATION_ANCHOR_REGEX.exec(trimmedHref)
    if (anchorMatch && anchorMatch[1]) {
      return { isCitation: true, index: anchorMatch[1] }
    }
  }

  return { isCitation: false }
}

/**
 * 长 URL 可读截断与格式化：
 * 去除冗余 scheme 和 www，保留域名主体与末尾路径，中间折叠为省略号，防止移动端窄屏排版撑破。
 */
export function formatDisplayUrl(rawUrl: string, maxLen = 42): string {
  const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : ''
  if (!trimmed) return ''

  const limit = Number.isFinite(maxLen) ? Math.max(8, Math.floor(maxLen)) : 42

  let display = trimmed
    .replace(URL_SCHEME_PREFIX_REGEX, '')
    .replace(WWW_PREFIX_REGEX, '')
    .replace(/\/+$/u, '')

  if (!display) display = trimmed

  if (display.length <= limit) return display

  const tailLength = Math.min(14, Math.floor(limit / 3))
  const headLength = Math.max(1, limit - tailLength - 1)
  return `${display.slice(0, headLength)}…${display.slice(-tailLength)}`
}

function extractDomain(href: string): string | undefined {
  try {
    const parsed = new URL(href)
    if (!parsed.hostname) return undefined
    return parsed.hostname.replace(WWW_PREFIX_REGEX, '')
  } catch {
    const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/iu.exec(href)
    return match && match[1] ? match[1].replace(WWW_PREFIX_REGEX, '') : undefined
  }
}

function isBareUrlText(text: string, href: string): boolean {
  const trimmedText = (text ?? '').trim()
  if (!trimmedText) return false
  const trimmedHref = (href ?? '').trim()
  if (trimmedText === trimmedHref) return true
  return BARE_URL_TEXT_REGEX.test(trimmedText)
}

/**
 * 链接多态分类器：
 * 将 Markdown 链接精准分类为 citation | external | workspace | session | standard。
 * 优先级：安全校验 → 内部目标（session / workspace）→ 引用角标 → 外部网络跳转 → 普通语义链接
 */
export function classifyMarkdownLink(href: string, text: string): MarkdownLinkInfo {
  const rawHref = typeof href === 'string' ? href : ''
  const rawText = typeof text === 'string' ? text : ''
  const trimmedHref = rawHref.trim()
  const trimmedText = rawText.trim()
  const plainLabel = trimmedText || trimmedHref

  if (!trimmedHref) {
    const emptyCitation = isCitationLink(trimmedText)
    if (emptyCitation.isCitation && emptyCitation.index) {
      return {
        kind: 'citation',
        rawHref,
        safeHref: null,
        displayText: emptyCitation.index,
        isBlocked: false,
        citationIndex: emptyCitation.index,
      }
    }
    return {
      kind: 'standard',
      rawHref,
      safeHref: null,
      displayText: plainLabel,
      isBlocked: false,
    }
  }

  const { safeHref, isBlocked, reason } = sanitizeAndValidateHref(rawHref)
  if (isBlocked || !safeHref) {
    return {
      kind: 'standard',
      rawHref,
      safeHref: null,
      displayText: plainLabel,
      isBlocked: true,
      blockReason: reason,
    }
  }

  const protocol = getProtocol(safeHref)

  // 1. 内置会话引用
  if (protocol === 'dsh-session:') {
    const sessionId = decodeSessionMentionUri(safeHref)
    return {
      kind: 'session',
      rawHref,
      safeHref,
      displayText: plainLabel || sessionId || '会话',
      isBlocked: false,
      sessionId,
    }
  }

  // 2. 工作区文件/代码资产链接（优先于纯文本数字检测，避免工作区文件被误判为角标）
  const wsPath = markdownFilePath(safeHref)
  if (wsPath !== undefined || protocol === 'workspace:') {
    return {
      kind: 'workspace',
      rawHref,
      safeHref,
      displayText: plainLabel,
      isBlocked: false,
      workspacePath: wsPath,
    }
  }

  // 3. 引用来源角标
  const citation = isCitationLink(trimmedText, safeHref)
  if (citation.isCitation && citation.index) {
    return {
      kind: 'citation',
      rawHref,
      safeHref,
      displayText: citation.index,
      isBlocked: false,
      citationIndex: citation.index,
    }
  }

  // 4. 外部网络跳转链接
  if (protocol === 'http:' || protocol === 'https:') {
    const domain = extractDomain(safeHref)
    const displayText = isBareUrlText(rawText, rawHref)
      ? formatDisplayUrl(safeHref)
      : plainLabel

    return {
      kind: 'external',
      rawHref,
      safeHref,
      displayText,
      isBlocked: false,
      domain,
    }
  }

  // 5. 普通语义行内链接（mailto、相对路径等）
  return {
    kind: 'standard',
    rawHref,
    safeHref,
    displayText: plainLabel,
    isBlocked: false,
  }
}

/**
 * 打开受信任的安全外部链接（仅放行 http:, https:, mailto:）
 * 返回 true 表示已尝试向系统分派打开请求，非外部安全协议一律阻断。
 */
export function openSafeExternalUrl(rawUrl: string): boolean {
  const { safeHref, isBlocked } = sanitizeAndValidateHref(rawUrl)
  if (isBlocked || !safeHref) return false

  const protocol = getProtocol(safeHref)
  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(protocol)) {
    return false
  }

  try {
    const pending = Linking.openURL(safeHref)
    if (pending && typeof (pending as Promise<void>).catch === 'function') {
      void (pending as Promise<void>).catch(() => undefined)
    }
    return true
  } catch {
    return false
  }
}

const SESSION_MENTION_SCHEME = 'dsh-session:'
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_VALUES: ReadonlyMap<string, number> = new Map(
  Array.from(BASE64_ALPHABET, (char, index) => [char, index] as const),
)

export function decodeBase64ToBytes(input: string): Uint8Array | undefined {
  if (typeof input !== 'string') return undefined
  // Strict Base64 padding check: '=' must only appear at the end, at most 2, and length % 4 == 0 if padded
  const padIndex = input.indexOf('=')
  if (padIndex !== -1) {
    const padding = input.slice(padIndex)
    if (!/^={1,2}$/.test(padding) || input.length % 4 !== 0) {
      return undefined
    }
  }

  const unpadded = input.replace(/=+$/u, '')
  if (unpadded.length === 0 || unpadded.length % 4 === 1) return undefined
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (let index = 0; index < unpadded.length; index += 1) {
    const value = BASE64_VALUES.get(unpadded.charAt(index))
    if (value === undefined) return undefined
    buffer = ((buffer << 6) | value) & 0xffffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }

  // Canonical Base64: unused trailing bits must be strictly zero
  if (bits > 0) {
    const unusedMask = (1 << bits) - 1
    if ((buffer & unusedMask) !== 0) return undefined
  }

  return Uint8Array.from(bytes)
}

export function decodeUtf8Bytes(bytes: Uint8Array): string | undefined {
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return undefined
    }
  }

  let result = ''
  let index = 0
  while (index < bytes.length) {
    const byte = bytes[index]!
    let codePoint: number
    let trailing: number
    let minCodePoint: number

    if (byte < 0x80) {
      codePoint = byte
      trailing = 0
      minCodePoint = 0
    } else if (byte >= 0xc2 && byte <= 0xdf) {
      codePoint = byte & 0x1f
      trailing = 1
      minCodePoint = 0x80
    } else if (byte >= 0xe0 && byte <= 0xef) {
      codePoint = byte & 0x0f
      trailing = 2
      minCodePoint = 0x800
    } else if (byte >= 0xf0 && byte <= 0xf4) {
      codePoint = byte & 0x07
      trailing = 3
      minCodePoint = 0x10000
    } else {
      return undefined
    }

    if (index + trailing >= bytes.length) return undefined

    for (let offset = 1; offset <= trailing; offset += 1) {
      const continuation = bytes[index + offset]!
      if ((continuation & 0xc0) !== 0x80) return undefined
      codePoint = (codePoint << 6) | (continuation & 0x3f)
    }

    // Overlong or surrogate or above maximum Unicode
    if (codePoint < minCodePoint || (codePoint >= 0xd800 && codePoint <= 0xdfff) || codePoint > 0x10ffff) {
      return undefined
    }

    result += String.fromCodePoint(codePoint)
    index += trailing + 1
  }
  return result
}

export function decodeSessionMentionUri(href: string): string | undefined {
  if (typeof href !== 'string') return undefined
  const value = href.trim()
  if (value.length <= SESSION_MENTION_SCHEME.length) return undefined
  if (!value.toLowerCase().startsWith(SESSION_MENTION_SCHEME)) return undefined
  const encoded = value.slice(SESSION_MENTION_SCHEME.length).trim()
  const normalized = encoded.replace(/-/gu, '+').replace(/_/gu, '/')
  const bytes = decodeBase64ToBytes(normalized)
  if (bytes === undefined) return undefined
  const json = decodeUtf8Bytes(bytes)
  if (json === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(json)
    return typeof parsed === 'string' && parsed.length > 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

export function createMarkdownParser(): MarkdownIt {
  const parser = new MarkdownIt({ html: false, linkify: true, breaks: true })
  installMath(parser)
  return parser
}
