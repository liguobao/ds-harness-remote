import { Linking } from 'react-native'
import MarkdownIt from 'markdown-it'
import { installMath } from './markdown-math'

const SAFE_EXTERNAL_URL = /^(?:https?|mailto):/iu
const BARE_WWW_URL = /^www\./iu

/**
 * Open an approved external URL.
 *
 * Returns `true` when the URL was recognized and an open was attempted — not
 * that it succeeded. Rejections are swallowed so a missing handler cannot produce
 * an unhandled promise rejection.
 */
export function openSafeExternalUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim()
  if (trimmed.length === 0) return false
  const url = BARE_WWW_URL.test(trimmed) ? `https://${trimmed}` : trimmed
  if (!SAFE_EXTERNAL_URL.test(url)) return false
  void Linking.openURL(url).catch(() => {})
  return true
}

const SESSION_MENTION_SCHEME = 'dsh-session:'
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_VALUES: ReadonlyMap<string, number> = new Map(
  Array.from(BASE64_ALPHABET, (char, index) => [char, index] as const),
)

function decodeBase64ToBytes(input: string): Uint8Array | undefined {
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
  return Uint8Array.from(bytes)
}

function decodeUtf8Bytes(bytes: Uint8Array): string | undefined {
  let result = ''
  let index = 0
  while (index < bytes.length) {
    const byte = bytes[index]
    if (byte === undefined) return undefined
    let codePoint: number
    let trailing: number
    if (byte < 0x80) {
      codePoint = byte
      trailing = 0
    } else if ((byte & 0xe0) === 0xc0) {
      codePoint = byte & 0x1f
      trailing = 1
    } else if ((byte & 0xf0) === 0xe0) {
      codePoint = byte & 0x0f
      trailing = 2
    } else if ((byte & 0xf8) === 0xf0) {
      codePoint = byte & 0x07
      trailing = 3
    } else {
      return undefined
    }
    if (index + trailing >= bytes.length) return undefined
    for (let offset = 1; offset <= trailing; offset += 1) {
      const continuation = bytes[index + offset]
      if (continuation === undefined || (continuation & 0xc0) !== 0x80) return undefined
      codePoint = (codePoint << 6) | (continuation & 0x3f)
    }
    if (codePoint > 0x10ffff) return undefined
    result += String.fromCodePoint(codePoint)
    index += trailing + 1
  }
  return result
}

/**
 * Decode a canonical `dsh-session:<base64url>` mention into a session id.
 *
 * The payload is the UTF-8 encoding of `JSON.stringify(sessionId)`, so the quotes
 * must be removed by `JSON.parse` — not by string trimming. Malformed payloads,
 * non-string JSON values, and empty ids all return `undefined`.
 */
export function decodeSessionMentionUri(href: string): string | undefined {
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

import { markdownFilePath } from './file-glyph'
export { markdownFilePath }

export function createMarkdownParser(): MarkdownIt {
  const parser = new MarkdownIt({ html: false, linkify: true, breaks: true })
  installMath(parser)
  return parser
}
