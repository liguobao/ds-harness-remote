import { beforeEach, describe, expect, it, vi } from 'vitest'

const { openURLMock } = vi.hoisted(() => ({
  openURLMock: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('react-native', () => ({
  Linking: {
    openURL: openURLMock,
    canOpenURL: vi.fn(() => Promise.resolve(true)),
  },
}))

import {
  createMarkdownParser,
  decodeSessionMentionUri,
  markdownFilePath,
  openSafeExternalUrl,
} from '../src/ui/link-helpers'

const parser = createMarkdownParser()

function collectLinkHrefs(source: string): string[] {
  const hrefs: string[] = []
  for (const token of parser.parse(source, {})) {
    for (const child of token.children ?? []) {
      if (child.type !== 'link_open') continue
      const href = child.attrGet('href')
      if (href !== null) hrefs.push(href)
    }
  }
  return hrefs
}

/** Mirror of the app-side encoder: base64/padded and base64url/unpadded. */
function mentionFromJson(json: string, unpadded = false): string {
  const base64 = Buffer.from(json, 'utf8').toString('base64')
  if (!unpadded) return `dsh-session:${base64}`
  return `dsh-session:${base64.replace(/=+$/u, '').replace(/\+/gu, '-').replace(/\//gu, '_')}`
}

function sessionMention(sessionId: string, unpadded = false): string {
  return mentionFromJson(JSON.stringify(sessionId), unpadded)
}

describe('openSafeExternalUrl', () => {
  beforeEach(() => {
    openURLMock.mockReset()
    openURLMock.mockImplementation(() => Promise.resolve(true))
  })

  it('opens https and http links', () => {
    expect(openSafeExternalUrl('https://example.com/docs')).toBe(true)
    expect(openURLMock).toHaveBeenLastCalledWith('https://example.com/docs')

    expect(openSafeExternalUrl('http://example.com')).toBe(true)
    expect(openURLMock).toHaveBeenLastCalledWith('http://example.com')
  })

  it('matches schemes case-insensitively', () => {
    expect(openSafeExternalUrl('HTTPS://EXAMPLE.COM/A')).toBe(true)
    expect(openURLMock).toHaveBeenLastCalledWith('HTTPS://EXAMPLE.COM/A')
  })

  it('opens mailto links', () => {
    expect(openSafeExternalUrl('mailto:dev@example.com')).toBe(true)
    expect(openURLMock).toHaveBeenLastCalledWith('mailto:dev@example.com')
  })

  it('upgrades a bare www host to https', () => {
    expect(openSafeExternalUrl('www.example.com/docs')).toBe(true)
    expect(openURLMock).toHaveBeenLastCalledWith('https://www.example.com/docs')
  })

  it('trims surrounding whitespace', () => {
    expect(openSafeExternalUrl('   https://example.com   ')).toBe(true)
    expect(openURLMock).toHaveBeenLastCalledWith('https://example.com')
  })

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<b>x</b>',
    'vbscript:msgbox(1)',
    'intent://scan#Intent;scheme=zxing;end',
    'file:///workspace/src/index.ts',
    'dsh-session:eyJhIjoxfQ==',
    '',
    '    ',
  ])('rejects %p without calling the opener', (url) => {
    expect(openSafeExternalUrl(url)).toBe(false)
    expect(openURLMock).not.toHaveBeenCalled()
  })

  it('reports "attempted" and swallows a rejected openURL promise', async () => {
    openURLMock.mockImplementationOnce(() => Promise.reject(new Error('no handler')))

    expect(openSafeExternalUrl('https://example.com')).toBe(true)

    await Promise.resolve()
    expect(openURLMock).toHaveBeenCalledTimes(1)
  })
})

describe('markdownFilePath', () => {
  it('keeps workspace-relative paths', () => {
    expect(markdownFilePath('src/index.ts')).toBe('src/index.ts')
    expect(markdownFilePath('docs/guide.md')).toBe('docs/guide.md')
  })

  it('strips a leading ./', () => {
    expect(markdownFilePath('./src/index.ts')).toBe('src/index.ts')
    expect(markdownFilePath('./')).toBeUndefined()
  })

  it('percent-decodes path segments', () => {
    expect(markdownFilePath('docs/My%20File.md')).toBe('docs/My File.md')
    expect(markdownFilePath('./docs/a%23b.md')).toBe('docs/a#b.md')
  })

  it('rejects malformed percent-encoding', () => {
    expect(markdownFilePath('docs/%ZZ.md')).toBeUndefined()
    expect(markdownFilePath('docs/%E0%A4%A.md')).toBeUndefined()
  })

  it('removes query strings and fragments', () => {
    expect(markdownFilePath('src/index.ts?view=raw')).toBe('src/index.ts')
    expect(markdownFilePath('src/index.ts#L10')).toBe('src/index.ts')
    expect(markdownFilePath('src/index.ts?view=raw#L10')).toBe('src/index.ts')
  })

  it('returns absolute paths unchanged', () => {
    expect(markdownFilePath('/workspace/src/index.ts')).toBe('/workspace/src/index.ts')
  })

  it('normalizes file: URLs', () => {
    expect(markdownFilePath('file:///workspace/src/index.ts')).toBe('/workspace/src/index.ts')
    expect(markdownFilePath('file:///C:/repo/src/index.ts')).toBe('C:/repo/src/index.ts')
    expect(markdownFilePath('file:///workspace/My%20File.md')).toBe('/workspace/My File.md')
  })

  it('accepts Windows drive paths without treating them as a scheme', () => {
    expect(markdownFilePath('C:/repo/src/index.ts')).toBe('C:/repo/src/index.ts')
    expect(markdownFilePath('C:/repo/docs/My%20File.md#L3')).toBe('C:/repo/docs/My File.md')
  })

  it('rejects anchors, protocol-relative paths, and empty input', () => {
    expect(markdownFilePath('#section')).toBeUndefined()
    expect(markdownFilePath('//host/share/file.md')).toBeUndefined()
    expect(markdownFilePath('')).toBeUndefined()
    expect(markdownFilePath('   ')).toBeUndefined()
  })

  it.each([
    'https://example.com/a.ts',
    'http://example.com',
    'mailto:dev@example.com',
    'data:text/plain,hello',
    'javascript:alert(1)',
    'dsh-session:eyJhIjoxfQ==',
  ])('does not classify %p as a workspace path', (href) => {
    expect(markdownFilePath(href)).toBeUndefined()
  })
})

describe('decodeSessionMentionUri', () => {
  it('decodes the JSON-encoded canonical payload', () => {
    expect(decodeSessionMentionUri(sessionMention('session-id-123'))).toBe('session-id-123')
  })

  it('decodes base64url payloads without padding', () => {
    expect(decodeSessionMentionUri(sessionMention('session-id-123', true))).toBe('session-id-123')
  })

  it('parses the JSON envelope instead of returning the raw payload', () => {
    const decoded = decodeSessionMentionUri(mentionFromJson('"abc"'))
    expect(decoded).toBe('abc')
    expect(decoded).not.toBe('"abc"')
  })

  it('decodes non-ASCII (UTF-8) session ids', () => {
    expect(decodeSessionMentionUri(sessionMention('会话-123'))).toBe('会话-123')
    expect(decodeSessionMentionUri(sessionMention('séance-émoji-🚀'))).toBe('séance-émoji-🚀')
  })

  it('trims surrounding whitespace', () => {
    expect(decodeSessionMentionUri(`  ${sessionMention('abc')}  `)).toBe('abc')
  })

  it.each([
    'dsh-session:',
    'dsh-session:   ',
    'dsh-session:!!!!',
    'dsh-session:a',
    'https://example.com',
    'src/index.ts',
    '',
  ])('returns undefined for %p', (href) => {
    expect(decodeSessionMentionUri(href)).toBeUndefined()
  })

  it('returns undefined for payloads that are not a JSON string', () => {
    expect(decodeSessionMentionUri(mentionFromJson('not json'))).toBeUndefined()
    expect(decodeSessionMentionUri(mentionFromJson('123'))).toBeUndefined()
    expect(decodeSessionMentionUri(mentionFromJson('null'))).toBeUndefined()
    expect(decodeSessionMentionUri(mentionFromJson('{"id":"abc"}'))).toBeUndefined()
    expect(decodeSessionMentionUri(mentionFromJson('""'))).toBeUndefined()
  })

  it('returns an id that the caller may fail to resolve', () => {
    expect(decodeSessionMentionUri(sessionMention('does-not-exist'))).toBe('does-not-exist')
  })

  it('returns undefined when the bytes are not valid UTF-8', () => {
    const invalidUtf8 = Buffer.from([0xff, 0xfe]).toString('base64')
    expect(decodeSessionMentionUri(`dsh-session:${invalidUtf8}`)).toBeUndefined()
  })
})

describe('parser linkification', () => {
  it('linkifies bare URLs in prose', () => {
    const hrefs = collectLinkHrefs('see https://example.com/docs for details')
    expect(hrefs).toEqual(['https://example.com/docs'])
  })

  it('linkifies bare www hosts', () => {
    const hrefs = collectLinkHrefs('visit www.example.com for docs')
    expect(hrefs).toHaveLength(1)
    expect(hrefs[0] ?? '').toMatch(/^https?:\/\/www\.example\.com\/?$/u)
  })

  it('keeps explicit markdown links', () => {
    expect(collectLinkHrefs('[docs](https://example.com/docs)')).toEqual([
      'https://example.com/docs',
    ])
    expect(collectLinkHrefs('[session](dsh-session:eyJhIjoxfQ==)')).toEqual([
      'dsh-session:eyJhIjoxfQ==',
    ])
  })

  it('does not linkify inline code', () => {
    expect(collectLinkHrefs('use `https://example.com` here')).toEqual([])
  })

  it('does not linkify fenced or indented code blocks', () => {
    expect(collectLinkHrefs('```\nhttps://example.com\n```')).toEqual([])
    expect(collectLinkHrefs('    https://example.com')).toEqual([])
  })

  it('does not create duplicate link tokens', () => {
    expect(collectLinkHrefs('<https://example.com>')).toEqual(['https://example.com'])
  })

  it('keeps raw HTML disabled', () => {
    const tokens = parser.parse('<b>bold</b>', {})
    expect(tokens.some((token) => token.type === 'html_inline' || token.type === 'html_block')).toBe(
      false,
    )
  })
})
