import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-haptics', () => ({ impactAsync: vi.fn(), ImpactFeedbackStyle: { Light: 'light' } }))
vi.mock('../src/services/storage', () => ({
  loadCodexPermissionPresets: async () => ({}),
  saveCodexPermissionPreset: vi.fn(),
  saveRecentWorkspaces: vi.fn(),
  loadDeviceCredentials: vi.fn(),
  saveDeviceCredentials: vi.fn(),
}))
vi.mock('../src/services/login', () => ({}))
vi.mock('../src/services/server-session', () => ({ serverSession: { authenticate: vi.fn() } }))

import {
  formatQuoteText,
  messageQuoteRanges,
  parseMessageQuotes,
  quoteTextOf,
} from '../src/ui/quote-helpers'
import { useBrowseMemory, updateBrowseEntry, browseScope, browseKey } from '../src/services/browse-memory'
import { createSessionActions } from '../src/state/session-actions'

describe('Quote helpers (upstream deepseek-harness conformance)', () => {
  describe('quoteTextOf', () => {
    it('removes single blockquote marker and normalizes line endings', () => {
      expect(quoteTextOf('> hello world')).toBe('hello world')
      expect(quoteTextOf('>   indented text')).toBe('  indented text')
      expect(quoteTextOf('>line without space')).toBe('line without space')
      expect(quoteTextOf('   > with leading spaces')).toBe('with leading spaces')
    })

    it('handles multiline quote blocks', () => {
      const input = '> line one\r\n> line two\r\n> line three'
      expect(quoteTextOf(input)).toBe('line one\nline two\nline three')
    })
  })

  describe('messageQuoteRanges', () => {
    it('detects single and multiline quotes', () => {
      const text = '> first quote\n\nSome normal text\n\n> second quote line 1\n> second quote line 2'
      const ranges = messageQuoteRanges(text)
      expect(ranges).toHaveLength(2)
      expect(text.slice(ranges[0]!.start, ranges[0]!.end)).toBe('> first quote')
      expect(text.slice(ranges[1]!.start, ranges[1]!.end)).toBe('> second quote line 1\n> second quote line 2')
    })

    it('ignores blank/whitespace-only blockquotes', () => {
      const text = '> \n>   \nSome text'
      expect(messageQuoteRanges(text)).toHaveLength(0)
    })
  })

  describe('formatQuoteText', () => {
    it('formats plain text lines into markdown blockquote lines', () => {
      expect(formatQuoteText('hello')).toBe('> hello')
      expect(formatQuoteText('line 1\r\nline 2\nline 3')).toBe('> line 1\n> line 2\n> line 3')
    })
  })

  describe('parseMessageQuotes', () => {
    it('separates leading quotes from the message body', () => {
      const message = '> quoted text\n\nThis is my response'
      const parsed = parseMessageQuotes(message)
      expect(parsed.quotes).toEqual(['quoted text'])
      expect(parsed.body).toBe('This is my response')
    })

    it('handles multiline leading quote', () => {
      const message = '> quote line 1\n> quote line 2\n\nQuestion about this'
      const parsed = parseMessageQuotes(message)
      expect(parsed.quotes).toEqual(['quote line 1\nquote line 2'])
      expect(parsed.body).toBe('Question about this')
    })

    it('handles multiple separate quotes before the body', () => {
      const message = '> quote 1\n\n> quote 2\n\nReply to both'
      const parsed = parseMessageQuotes(message)
      expect(parsed.quotes).toEqual(['quote 1', 'quote 2'])
      expect(parsed.body).toBe('Reply to both')
    })

    it('returns empty quotes array if message does not start with quote', () => {
      const message = 'I think that:\n> quote in middle\nwhat do you think?'
      const parsed = parseMessageQuotes(message)
      expect(parsed.quotes).toEqual([])
      expect(parsed.body).toBe(message)
    })

    it('handles message containing only a quote', () => {
      const message = '> solitary quote'
      const parsed = parseMessageQuotes(message)
      expect(parsed.quotes).toEqual(['solitary quote'])
      expect(parsed.body).toBe('')
    })
  })
})

describe('Quote state and session integration', () => {
  it('adds quotes to browse-memory for target session via quoteChatMessage', () => {
    const scope = browseScope({
      config: { baseUrl: 'https://test.server', account: 'test@example.com' },
      selectedDevice: { deviceId: 'dev-1', identityKey: 'key-1' } as any,
    })
    const sessionId = 'session-quote-1'
    const key = browseKey(scope, sessionId)

    const stateMock = {
      config: { baseUrl: 'https://test.server', account: 'test@example.com' },
      selectedDevice: { deviceId: 'dev-1', identityKey: 'key-1' },
      selectedSession: { sessionId, backend: 'harness' },
      connection: { phase: 'connected' },
      sessions: [],
      sessionLifecycles: {},
      messages: {},
      feedbackBySession: {},
    }

    const setMock = vi.fn()
    const getMock = vi.fn().mockReturnValue(stateMock)
    const runtimeMock = {
      connection: {
        requireProxy: vi.fn(),
      },
    }

    const actions = createSessionActions({ get: getMock, set: setMock, runtime: runtimeMock as any })
    actions.quoteChatMessage('First quoted message', sessionId)

    const entry = useBrowseMemory.getState().entries[key]
    expect(entry?.quotes).toEqual(['First quoted message'])

    actions.quoteChatMessage('Second quoted message', sessionId)
    const updated = useBrowseMemory.getState().entries[key]
    expect(updated?.quotes).toEqual(['First quoted message', 'Second quoted message'])
  })

  it('ignores empty or whitespace-only quotes', () => {
    const scope = browseScope({
      config: { baseUrl: 'https://test.server', account: 'test@example.com' },
      selectedDevice: { deviceId: 'dev-1', identityKey: 'key-1' } as any,
    })
    const sessionId = 'session-quote-empty'
    const key = browseKey(scope, sessionId)

    const stateMock = {
      config: { baseUrl: 'https://test.server', account: 'test@example.com' },
      selectedDevice: { deviceId: 'dev-1', identityKey: 'key-1' },
      selectedSession: { sessionId, backend: 'harness' },
    }
    const actions = createSessionActions({ get: () => stateMock as any, set: vi.fn(), runtime: {} as any })
    actions.quoteChatMessage('   ', sessionId)

    const entry = useBrowseMemory.getState().entries[key]
    expect(entry?.quotes).toBeUndefined()
  })
})
