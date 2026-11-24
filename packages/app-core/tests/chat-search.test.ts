import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  Platform: { OS: 'android' },
  StyleSheet: { create: <T,>(s: T): T => s },
}))

import { chatSections } from '../src/state/message-helpers'
import type { ChatItem, ChatMessage } from '../src/types'
import { createMarkdownParser } from '../src/ui/link-helpers'
import { parseCalloutNode, type MarkdownNode } from '../src/ui/markdown-helpers'
import { chunkTranscriptSections } from '../src/screens/chat/transcript-chunks'
import {
  allocateBlockSearchHighlight,
  buildChatSearchIndex,
  clampSearchIndex,
  countMarkdownNodesMatches,
  countTextMatches,
  resolveInitialSearchIndex,
  resolveNextSearchIndex,
  resolvePagedUserMatchLocation,
  splitHighlightRuns,
  USER_MESSAGE_INLINE_LIMIT,
  USER_MESSAGE_PAGE_SIZE,
} from '../src/screens/chat/chat-search'

const parser = createMarkdownParser()

function parseTree(text: string): MarkdownNode[] {
  const tokens = parser.parse(text.replace(/\r\n?/g, '\n'), {})
  if (tokens.length === 0) return []
  const root: MarkdownNode = { key: -1, token: tokens[0]!, children: [] }
  const stack = [root]
  tokens.forEach((token, key) => {
    if (token.nesting === -1) {
      if (stack.length > 1) stack.pop()
      return
    }
    const node: MarkdownNode = { key, token, children: [] }
    stack.at(-1)!.children.push(node)
    if (token.nesting === 1) stack.push(node)
  })
  return root.children
}

function makeMessage(overrides: Partial<ChatMessage> & { id: string; role: ChatMessage['role']; text: string }): ChatMessage {
  return {
    kind: 'message',
    sessionId: 'sess-1',
    createdAt: 1_000,
    ...overrides,
  }
}

describe('chat-search pure index & highlight helpers', () => {
  it('splits highlight runs case-insensitively and preserves non-matching spans', () => {
    expect(splitHighlightRuns('Hello Codex and codex-acp!', 'CODEX')).toEqual([
      { text: 'Hello ', matchOffset: null },
      { text: 'Codex', matchOffset: 0 },
      { text: ' and ', matchOffset: null },
      { text: 'codex', matchOffset: 1 },
      { text: '-acp!', matchOffset: null },
    ])
    expect(splitHighlightRuns('No hits here', '   ')).toEqual([
      { text: 'No hits here', matchOffset: null },
    ])
  })

  it('indexes chunked long replies per MarkdownChunkSection without double-counting', () => {
    const longBlocks = Array.from({ length: 12 }, (_, i) =>
      `## Section ${i}\n\nParagraph ${i} mentions targetToken once.`,
    ).join('\n\n')
    const items: ChatItem[] = [
      makeMessage({ id: 'u1', role: 'user', text: 'Explain targetToken briefly' }),
      makeMessage({
        id: 'a1',
        role: 'assistant',
        text: longBlocks,
        reasoning: 'Internal reasoning with targetToken should stay hidden',
        turn: 'turn-1',
        turnEnd: { reason: 'completed', time: 2_000 },
      }),
    ]
    const sections = chatSections(items)
    const display = chunkTranscriptSections(sections, {
      liveTurnKeys: new Set(),
      isSessionRunning: false,
      parseBlocks: parseTree,
      extractFiles: () => [],
    })
    const chunkSections = display.filter(sec => sec.kind === 'markdown-chunk')
    expect(chunkSections.length).toBeGreaterThan(1)

    const index = buildChatSearchIndex(display, 'targettoken', parseTree)
    // 1 hit in user prompt + 12 hits across the chunked assistant reply = 13 total
    expect(index.matches).toHaveLength(13)
    expect(index.matches[0]).toEqual({ sectionKey: sections[0]!.key, sectionIndex: 0, localIndex: 0 })
    const totalInChunks = chunkSections.reduce(
      (sum, sec) => sum + (index.countBySectionKey.get(sec.key) ?? 0),
      0,
    )
    expect(totalInChunks).toBe(12)
  })

  it('skips hidden process-prefix final response and collapsed tool/reasoning items', () => {
    const longBlocks = Array.from({ length: 10 }, (_, i) =>
      `### Step ${i}\n\nDetail ${i} uses alphaKey here.`,
    ).join('\n\n')
    const items: ChatItem[] = [
      {
        kind: 'tool',
        id: 't1',
        sessionId: 'sess-1',
        createdAt: 1_000,
        turn: 'turn-2',
        toolName: 'read_file',
        state: 'finished',
        arguments: '{"path":"alphaKey.ts"}',
        resultDetail: { text: 'alphaKey inside tool output', format: 'code' },
      },
      makeMessage({
        id: 'a-interim',
        role: 'assistant',
        text: 'Interim alphaKey note before final reply.',
        turn: 'turn-2',
      }),
      {
        kind: 'tool',
        id: 't2',
        sessionId: 'sess-1',
        createdAt: 1_100,
        turn: 'turn-2',
        toolName: 'bash',
        state: 'finished',
        resultDetail: { text: 'alphaKey in collapsed bash', format: 'code' },
      },
      makeMessage({
        id: 'a-final',
        role: 'assistant',
        text: longBlocks,
        turn: 'turn-2',
        turnEnd: { reason: 'completed', time: 2_000 },
      }),
    ]

    const sections = chatSections(items)
    const display = chunkTranscriptSections(sections, {
      liveTurnKeys: new Set(),
      isSessionRunning: false,
      parseBlocks: parseTree,
      extractFiles: () => [],
    })
    expect(display[0]?.kind).toBe('process-prefix')

    const index = buildChatSearchIndex(display, 'alphaKey', parseTree)
    // 1 hit in interim response inside process-prefix + 10 hits in chunked final response = 11
    expect(index.matches).toHaveLength(11)
    expect(index.countBySectionKey.get(display[0]!.key)).toBe(1)
  })

  it('matches code blocks, inline code, tables, callouts, and strips handoff context on user messages', () => {
    const handoffPayload = [
      '<!-- dsh-handoff:v1 {"version":1,"sourceBackend":"claude","targetBackend":"codex","sourceSessionId":"src-1","preset":"review","turnsCount":2,"filesCount":1,"omittedTurns":0,"createdAt":1000} -->',
      '<handoff_context>',
      'Dropped handoff needleKeyword inside hidden card',
      '</handoff_context>',
      'Visible instruction with needleKeyword',
    ].join('\n')
    const assistantRich = [
      '> [!TIP] needleKeyword callout title',
      '> Body with `needleKeyword` inline code',
      '',
      '| Col | Val |',
      '| --- | --- |',
      '| A | needleKeyword |',
      '',
      '```ts',
      'const x = "needleKeyword"',
      '```',
      '',
      '```mermaid',
      'graph TD; A[needleKeyword]-->B',
      '```',
    ].join('\n')

    const items: ChatItem[] = [
      makeMessage({ id: 'u-handoff', role: 'user', text: handoffPayload }),
      makeMessage({ id: 'a-rich', role: 'assistant', text: assistantRich }),
    ]
    const display = chunkTranscriptSections(chatSections(items), {
      liveTurnKeys: new Set(),
      isSessionRunning: false,
      parseBlocks: parseTree,
      extractFiles: () => [],
    })

    const index = buildChatSearchIndex(display, 'needleKeyword', parseTree)
    // User instruction: 1; Assistant: callout title (1) + inline code (1) + table cell (1) + ts code block (1); mermaid skipped = 5
    expect(index.matches).toHaveLength(5)
  })

  it('locates exact page and local offset for paged long user messages', () => {
    const prefix = 'a'.repeat(USER_MESSAGE_PAGE_SIZE + 50)
    const padding = 'b'.repeat(USER_MESSAGE_INLINE_LIMIT)
    const longText = `${prefix}FIND_ME_HERE${padding}`
    const items: ChatItem[] = [
      makeMessage({ id: 'u-long', role: 'user', text: longText }),
    ]
    const display = chunkTranscriptSections(chatSections(items), {
      liveTurnKeys: new Set(),
      isSessionRunning: false,
      parseBlocks: parseTree,
      extractFiles: () => [],
    })
    const index = buildChatSearchIndex(display, 'FIND_ME_HERE', parseTree)
    expect(index.matches).toHaveLength(1)
    const loc = resolvePagedUserMatchLocation(longText, 'FIND_ME_HERE', 0)
    expect(loc).toEqual({ page: 1, pageLocalActiveIndex: 0 })
  })

  it('navigates prev/next with wrap-around and clamps safely', () => {
    expect(resolveInitialSearchIndex(0)).toBe(-1)
    expect(resolveInitialSearchIndex(5)).toBe(4)

    expect(resolveNextSearchIndex(4, 5, 'next')).toBe(0)
    expect(resolveNextSearchIndex(0, 5, 'prev')).toBe(4)
    expect(resolveNextSearchIndex(2, 5, 'prev')).toBe(1)
    expect(resolveNextSearchIndex(2, 5, 'next')).toBe(3)
    expect(resolveNextSearchIndex(0, 0, 'next')).toBe(-1)

    expect(clampSearchIndex(4, 3)).toBe(2)
    expect(clampSearchIndex(-1, 3)).toBe(2)
    expect(clampSearchIndex(1, 0)).toBe(-1)
  })

  it('allocates callout baseIndex synchronously so trailing blocks stay aligned', () => {
    const markdown = [
      '> [!TIP] token in callout title',
      '> First body token',
      '>',
      '> Second body token',
      '',
      'Trailing paragraph token.',
      '',
      '```ts',
      'const after = "token"',
      '```',
    ].join('\n')

    const blocks = parseTree(markdown)
    const callout = parseCalloutNode(blocks[0]!)
    expect(callout).not.toBeNull()

    const items: ChatItem[] = [makeMessage({ id: 'a-callout-order', role: 'assistant', text: markdown })]
    const display = chunkTranscriptSections(chatSections(items), {
      liveTurnKeys: new Set(),
      isSessionRunning: false,
      parseBlocks: parseTree,
      extractFiles: () => [],
    })
    const index = buildChatSearchIndex(display, 'token', parseTree)
    expect(index.matches.map(m => m.localIndex)).toEqual([0, 1, 2, 3, 4])

    const sharedCounter = { current: 0 }
    const calloutSlice = allocateBlockSearchHighlight(
      countTextMatches(callout!.title, 'token') + countMarkdownNodesMatches(callout!.children, 'token'),
      { query: 'token', activeLocalIndex: 3, counter: sharedCounter },
    )
    // CalloutCard consumes indices 0..2 synchronously during parent traversal.
    expect(calloutSlice).toEqual({ query: 'token', activeLocalIndex: 3, baseIndex: 0 })
    // Trailing paragraph occupies index 3 and trailing code block starts at baseIndex 4.
    const trailingParaSlice = allocateBlockSearchHighlight(
      countMarkdownNodesMatches([blocks[1]!], 'token'),
      { query: 'token', activeLocalIndex: 3, counter: sharedCounter },
    )
    const trailingCodeSlice = allocateBlockSearchHighlight(
      countMarkdownNodesMatches([blocks[2]!], 'token'),
      { query: 'token', activeLocalIndex: 3, counter: sharedCounter },
    )
    expect(trailingParaSlice?.baseIndex).toBe(3)
    expect(trailingCodeSlice?.baseIndex).toBe(4)
  })
})
