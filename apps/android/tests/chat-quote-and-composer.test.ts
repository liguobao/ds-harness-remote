import { describe, expect, it } from 'vitest'
import { formatQuoteDraftSnippet, formatQuoteText, formatTokens } from '../src/ui/quote-helpers'

describe('Quote snippet formatting (Figure 3 alignment)', () => {
  it('truncates text exceeding maxLength and appends ellipsis', () => {
    const text = '跳转到“安全验证”，显示：“请您登录后查看更多专业优质内容。'
    const snippet = formatQuoteDraftSnippet(text, 16)
    expect(snippet).toBe('跳转到“安全验证”，显示：“请您...')
  })

  it('preserves text within maxLength without ellipsis', () => {
    const text = '简单回复'
    expect(formatQuoteDraftSnippet(text, 24)).toBe('简单回复')
  })

  it('normalizes internal newlines and tabs to single spaces', () => {
    const text = 'line 1\r\n\tline 2\nline 3'
    expect(formatQuoteDraftSnippet(text, 50)).toBe('line 1 line 2 line 3')
  })

  it('formats full quotes with markdown blockquote prefix for every line', () => {
    const quote = '第一行\n第二行\n\n第四行'
    expect(formatQuoteText(quote)).toBe('> 第一行\n> 第二行\n> \n> 第四行')
  })
})

describe('Token count formatting (Figure 4 alignment)', () => {
  it('formats counts under 1000 as exact integers', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(850)).toBe('850')
  })

  it('formats counts >= 1000 as decimal thousands (k)', () => {
    expect(formatTokens(20600)).toBe('20.6k')
    expect(formatTokens(22437)).toBe('22.4k')
    expect(formatTokens(1500)).toBe('1.5k')
  })

  it('rounds counts >= 100k to whole thousands', () => {
    expect(formatTokens(125400)).toBe('125k')
  })

  it('returns empty string for undefined or invalid count', () => {
    expect(formatTokens(undefined)).toBe('')
    expect(formatTokens(-1)).toBe('')
    expect(formatTokens(NaN)).toBe('')
  })
})

describe('Blank session detection (Sidebar New Session deduplication)', () => {
  function isReusableBlank(s: { blank?: boolean; sessionId: string }, messagesRecord: Record<string, unknown[] | undefined>): boolean {
    if (s.blank === true) return true
    if (s.blank === false) return false
    const localMsgs = messagesRecord[s.sessionId]
    return Array.isArray(localMsgs) && localMsgs.length === 0
  }

  it('recognizes explicit server blank sessions', () => {
    expect(isReusableBlank({ sessionId: 's1', blank: true }, {})).toBe(true)
  })

  it('rejects un-cached history sessions with blank=false', () => {
    expect(isReusableBlank({ sessionId: 's2', blank: false }, {})).toBe(false)
  })

  it('rejects un-cached history sessions with blank=undefined (messages not yet fetched)', () => {
    expect(isReusableBlank({ sessionId: 's2-uncached' }, {})).toBe(false)
  })

  it('rejects history sessions with populated messages', () => {
    expect(isReusableBlank({ sessionId: 's3' }, { s3: [{ text: 'hello' }] })).toBe(false)
  })

  it('accepts sessions where messages were fetched and verified empty', () => {
    expect(isReusableBlank({ sessionId: 's4' }, { s4: [] })).toBe(true)
  })
})
