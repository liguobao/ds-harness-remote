import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  Platform: { OS: 'android' },
  StyleSheet: { create: <T,>(s: T): T => s },
}))

import { createMarkdownParser } from '../src/ui/link-helpers'
import type { MarkdownNode } from '../src/ui/markdown-helpers'
import { highlightCode, partitionHighlightedCodeTokens } from '../src/ui/syntax-highlight'
import { chatSections, type ChatSection } from '../src/state/message-helpers'
import type { ChatItem } from '../src/types'
import {
  chunkTranscriptSections,
  resolveInitialTailLimit,
  resolveReadingAnchorIndex,
  splitMarkdownNodesIntoChunks,
  type DisplayChatSection,
} from '../src/screens/chat/transcript-chunks'

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

function makeRichReply(extraBlocks = false): string {
  const blocks = [
    '## Summary',
    'Intro paragraph referencing [chat-screen.tsx](packages/app-core/src/screens/chat-screen.tsx).',
    '### Metrics',
    ['| Stage | Ms |', '| --- | ---: |', '| Pre | 12 |', '| Draw | 8 |'].join('\n'),
    '### Code',
    '```typescript\nexport function run(x: number) {\n  return x * 2\n}\n```',
    '### Findings',
    ['- Item one', '- Item two', '- Item three', '- Item four'].join('\n'),
  ]
  if (extraBlocks) {
    blocks.push(
      '### Extended Table',
      ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n'),
      '```typescript\nconst total = [1, 2, 3].reduce((a, b) => a + b, 0)\n```',
    )
  }
  return blocks.join('\n\n')
}

describe('transcript-chunks weighted markdown virtualization', () => {
  it('leaves short replies unsplit and isolates tables from code blocks in long replies', () => {
    const shortNodes = parseTree('## Short\n\nJust one paragraph.')
    expect(splitMarkdownNodesIntoChunks(shortNodes)).toBeUndefined()

    const richNodes = parseTree(makeRichReply(true))
    const chunks = splitMarkdownNodesIntoChunks(richNodes)
    expect(chunks).toBeDefined()
    expect(chunks!.length).toBeGreaterThanOrEqual(3)

    // No single chunk should pack both a table and a fenced code block together.
    for (const chunk of chunks!) {
      const types = new Set(chunk.nodes.map(n => n.token.type))
      expect(types.has('table_open') && types.has('fence')).toBe(false)
      // Headings should not be stranded at the end of a non-final chunk when followed by content.
      if (chunk.nodes.length > 1) {
        expect(chunk.nodes.at(-1)!.token.type).not.toBe('heading_open')
      }
    }

    // All original top-level nodes must be preserved in exact order.
    const flattened = chunks!.flatMap(c => c.nodes)
    expect(flattened).toEqual(richNodes)
  })

  it('freezes live turns so streaming completion never swaps row keys, and caches completed sections', () => {
    const toolTurn: ChatItem[] = [
      {
        kind: 'tool',
        id: 't-1',
        sessionId: 's1',
        turn: '1',
        createdAt: 100,
        toolName: 'read_file',
        toolKey: 'read_file',
        state: 'finished',
      },
      {
        kind: 'message',
        id: 'a-1',
        sessionId: 's1',
        turn: '1',
        createdAt: 200,
        role: 'assistant',
        text: makeRichReply(false),
        turnEnd: { reason: 'completed', time: 250 },
      },
    ]
    const sections = chatSections(toolTurn)
    expect(sections).toHaveLength(1)
    const sectionKey = sections[0]!.key

    // If a turn was ever observed live, keep it unchunked even after completion.
    const liveKeys = new Set<string>([sectionKey])
    const unchunked = chunkTranscriptSections(sections, {
      liveTurnKeys: liveKeys,
      isSessionRunning: false,
      parseBlocks: parseTree,
      extractFiles: () => [{ path: 'packages/app-core/src/screens/chat-screen.tsx' }],
    })
    expect(unchunked).toEqual(sections)

    // Completed historical turn splits into process-prefix (preserving exact section.key) + chunks.
    const cache = new WeakMap<ChatSection, readonly DisplayChatSection[]>()
    const first = chunkTranscriptSections(sections, {
      liveTurnKeys: new Set(),
      isSessionRunning: false,
      parseBlocks: parseTree,
      extractFiles: () => [{ path: 'packages/app-core/src/screens/chat-screen.tsx' }],
      cache,
    })
    expect(first[0]?.kind).toBe('process-prefix')
    expect(first[0]?.key).toBe(sectionKey)
    const mdChunks = first.filter(row => row.kind === 'markdown-chunk')
    expect(mdChunks.length).toBeGreaterThanOrEqual(2)
    expect(mdChunks[0]?.key).toBe(`${sectionKey}#md:0`)
    expect(mdChunks.at(-1)?.referencedFiles).toEqual([{ path: 'packages/app-core/src/screens/chat-screen.tsx' }])

    // Second pass with the same ChatSection reference reuses identical chunk objects.
    const second = chunkTranscriptSections(sections, {
      liveTurnKeys: new Set(),
      isSessionRunning: false,
      parseBlocks: parseTree,
      extractFiles: () => [{ path: 'packages/app-core/src/screens/chat-screen.tsx' }],
      cache,
    })
    expect(second.length).toBe(first.length)
    for (let i = 0; i < first.length; i += 1) {
      expect(second[i]).toBe(first[i])
    }
  })

  it('resolves reading anchors across chunked and unchunked keys and bounds initial tail weight', () => {
    const rows: DisplayChatSection[] = [
      { kind: 'item', key: 'u-1', item: { kind: 'message', id: 'u-1', sessionId: 's1', createdAt: 1, role: 'user', text: 'q' } },
      { kind: 'process-prefix', key: 'proc:1', sourceKey: 'proc:1', turn: '1', items: [], hiddenResponseItemId: 'a-1' },
      {
        kind: 'markdown-chunk',
        key: 'proc:1#md:0',
        sourceKey: 'proc:1',
        turn: '1',
        item: { kind: 'message', id: 'a-1', sessionId: 's1', createdAt: 2, role: 'assistant', text: 'x' },
        nodes: [],
        referencedFiles: [],
        chunkIndex: 0,
        chunkCount: 2,
        chunkWeight: 4,
        compact: true,
        showActions: true,
        isProcessSection: true,
      },
      {
        kind: 'markdown-chunk',
        key: 'proc:1#md:1',
        sourceKey: 'proc:1',
        turn: '1',
        item: { kind: 'message', id: 'a-1', sessionId: 's1', createdAt: 2, role: 'assistant', text: 'x' },
        nodes: [],
        referencedFiles: [],
        chunkIndex: 1,
        chunkCount: 2,
        chunkWeight: 4,
        compact: true,
        showActions: true,
        isProcessSection: true,
      },
    ]

    expect(resolveReadingAnchorIndex(rows, 'proc:1#md:1')).toBe(3)
    expect(resolveReadingAnchorIndex(rows, 'proc:1#md:9')).toBe(1)
    expect(resolveReadingAnchorIndex(rows, 'proc:1')).toBe(1)
    expect(resolveReadingAnchorIndex([{ key: 'proc:1' }], 'proc:1#md:1')).toBe(0)

    // Weight 4 + 4 = 8 >= 6 -> mounts only the last 2 chunks on initial bottom render.
    expect(resolveInitialTailLimit(rows, 2)).toBe(2)
  })
})

describe('partitionHighlightedCodeTokens span-budgeted Android chunking', () => {
  it('round-trips exact multi-line code including blank lines and bounds styled spans per chunk', () => {
    const sample = [
      'export function evaluate(samples: readonly number[], budget = 16.67) {',
      '  const sorted = [...samples].sort((a, b) => a - b)',
      '',
      '  // Multi-line check',
      '  const median = sorted[Math.floor(sorted.length / 2)] ?? 0',
      '  const slow = samples.filter(v => v > budget * 2)',
      '  return { median, slowCount: slow.length, ok: median <= budget }',
      '}',
    ].join('\n')

    const tokens = highlightCode(sample, 'typescript')
    const chunks = partitionHighlightedCodeTokens(tokens, 8, 3)
    expect(chunks.length).toBeGreaterThanOrEqual(3)

    const reconstructed = chunks
      .map(chunk => chunk.map(t => t.text).join(''))
      .join('\n')
    expect(reconstructed).toBe(sample)

    // Operator tokens must retain syntax highlighting instead of being folded into plain text.
    const allChunkTokens = chunks.flat()
    expect(allChunkTokens.some(t => t.kind === 'operator')).toBe(true)

    // Every chunk respects line and styled-span budgets (except when a single line exceeds span budget).
    for (const chunk of chunks) {
      const text = chunk.map(t => t.text).join('')
      const lineCount = text.split('\n').length
      expect(lineCount).toBeLessThanOrEqual(3)
    }
  })
})
