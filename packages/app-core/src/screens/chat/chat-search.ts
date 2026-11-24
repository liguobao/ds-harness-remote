import type { Token } from 'markdown-it'
import { parseHandoffMessage } from '../../lib/handoff-context'
import { hasVisibleMessageText } from '../../state/event-reducer'
import type { ChatMessage } from '../../types'
import { heartbeatMessageBody } from '../../ui/heartbeat-message'
import { classifyMarkdownLink } from '../../ui/link-helpers'
import { getTaskInfo, parseCalloutNode, type MarkdownNode } from '../../ui/markdown-helpers'
import { parseMessageQuotes } from '../../ui/quote-helpers'
import { processSegments } from '../chat-process'
import { extractUserSubmittedFiles } from './submitted-files'
import type { DisplayChatSection } from './transcript-chunks'

export const USER_MESSAGE_INLINE_LIMIT = 8192
export const USER_MESSAGE_PAGE_SIZE = 1024

export interface SearchHighlightState {
  query: string
  /** 0-based index within the owning DisplayChatSection, or null when active match is elsewhere. */
  activeLocalIndex: number | null
}

export interface BlockSearchHighlight extends SearchHighlightState {
  baseIndex: number
}

export function allocateBlockSearchHighlight(
  matchCount: number,
  search: { query: string; activeLocalIndex: number | null; counter: { current: number } } | undefined,
): BlockSearchHighlight | undefined {
  if (search === undefined) return undefined
  const baseIndex = search.counter.current
  search.counter.current += matchCount
  if (matchCount <= 0) return undefined
  return {
    query: search.query,
    activeLocalIndex: search.activeLocalIndex,
    baseIndex,
  }
}

export interface ChatSearchMatch {
  sectionKey: string
  sectionIndex: number
  localIndex: number
}

export interface ChatSearchIndex {
  query: string
  matches: readonly ChatSearchMatch[]
  countBySectionKey: ReadonlyMap<string, number>
}

export interface HighlightRun {
  text: string
  /** 0-based match index within this string fragment, or null for non-matching runs. */
  matchOffset: number | null
}

export interface TextMatchRange {
  start: number
  end: number
}

export function normalizeSearchQuery(query: string): string {
  return query.replace(/[\r\n]+/gu, ' ').trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

export function findMatchRanges(text: string, query: string): TextMatchRange[] {
  const normalized = normalizeSearchQuery(query)
  if (normalized.length === 0 || text.length === 0) return []
  const ranges: TextMatchRange[] = []
  const regex = new RegExp(escapeRegExp(normalized), 'giu')
  for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
    const matchedText = match[0]
    if (matchedText.length === 0) {
      regex.lastIndex += 1
      continue
    }
    ranges.push({ start: match.index, end: match.index + matchedText.length })
  }
  return ranges
}

export function countTextMatches(text: string, query: string): number {
  return findMatchRanges(text, query).length
}

export function splitHighlightRuns(text: string, query: string): HighlightRun[] {
  const ranges = findMatchRanges(text, query)
  if (ranges.length === 0) return text.length === 0 ? [] : [{ text, matchOffset: null }]
  const runs: HighlightRun[] = []
  let cursor = 0
  for (let i = 0; i < ranges.length; i += 1) {
    const { start, end } = ranges[i]!
    if (start > cursor) {
      runs.push({ text: text.slice(cursor, start), matchOffset: null })
    }
    runs.push({ text: text.slice(start, end), matchOffset: i })
    cursor = end
  }
  if (cursor < text.length) {
    runs.push({ text: text.slice(cursor), matchOffset: null })
  }
  return runs
}

export function pagedUserBoundary(text: string, index: number): number {
  const offset = index * USER_MESSAGE_PAGE_SIZE
  if (offset <= 0) return 0
  if (offset >= text.length) return text.length
  const before = text.charCodeAt(offset - 1)
  const after = text.charCodeAt(offset)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff ? offset - 1 : offset
}

export function resolvePagedUserMatchLocation(
  text: string,
  query: string,
  activeLocalIndex: number | null,
): { page: number; pageLocalActiveIndex: number | null } {
  const count = Math.max(1, Math.ceil(text.length / USER_MESSAGE_PAGE_SIZE))
  if (activeLocalIndex === null || activeLocalIndex < 0) {
    return { page: 0, pageLocalActiveIndex: null }
  }
  let seen = 0
  for (let page = 0; page < count; page += 1) {
    const slice = text.slice(pagedUserBoundary(text, page), pagedUserBoundary(text, page + 1))
    const pageMatches = countTextMatches(slice, query)
    if (activeLocalIndex < seen + pageMatches) {
      return { page, pageLocalActiveIndex: activeLocalIndex - seen }
    }
    seen += pageMatches
  }
  return { page: 0, pageLocalActiveIndex: null }
}

function countPagedUserMatches(text: string, query: string): number {
  const count = Math.max(1, Math.ceil(text.length / USER_MESSAGE_PAGE_SIZE))
  let total = 0
  for (let page = 0; page < count; page += 1) {
    const slice = text.slice(pagedUserBoundary(text, page), pagedUserBoundary(text, page + 1))
    total += countTextMatches(slice, query)
  }
  return total
}

function findClosingToken(tokens: readonly Token[], opening: number): number {
  const type = tokens[opening]!.type.replace(/_open$/, '_close')
  let depth = 0
  for (let index = opening + 1; index < tokens.length; index += 1) {
    if (tokens[index]!.type === tokens[opening]!.type) depth += 1
    if (tokens[index]!.type === type) {
      if (depth === 0) return index
      depth -= 1
    }
  }
  return -1
}

function extractBlockText(node: MarkdownNode): string {
  if (node.token.content) return node.token.content
  return node.children.map(extractBlockText).filter(Boolean).join('\n')
}

function countInlineTokensMatches(tokens: readonly Token[], query: string): number {
  let total = 0
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (token.type === 'math_inline' || token.type === 'image' || token.type === 'softbreak' || token.type === 'hardbreak') {
      continue
    }
    if (token.type === 'text' || token.type === 'code_inline') {
      total += countTextMatches(token.content, query)
      continue
    }
    if (token.nesting === 1) {
      const closing = findClosingToken(tokens, index)
      if (closing < 0) continue
      const inner = tokens.slice(index + 1, closing)
      if (token.type === 'link_open') {
        const href = token.attrGet('href') ?? ''
        const rawText = inner.map(t => t.content).join('')
        const linkInfo = classifyMarkdownLink(href, rawText)
        if (linkInfo.isBlocked) {
          total += countInlineTokensMatches(inner, query)
        } else if (linkInfo.kind === 'citation') {
          total += linkInfo.citationIndex
            ? countTextMatches(`[${linkInfo.citationIndex}]`, query)
            : countInlineTokensMatches(inner, query)
        } else if (linkInfo.kind === 'external' && linkInfo.displayText !== rawText && linkInfo.displayText.length > 0) {
          total += countTextMatches(linkInfo.displayText, query)
        } else {
          total += countInlineTokensMatches(inner, query)
        }
      } else {
        total += countInlineTokensMatches(inner, query)
      }
      index = closing
      continue
    }
    if (token.content.length > 0) {
      total += countTextMatches(token.content, query)
    }
  }
  return total
}

export function countInlineChildrenMatches(nodes: readonly MarkdownNode[], query: string): number {
  let total = 0
  for (const node of nodes) {
    if (node.token.type === 'inline') {
      total += countInlineTokensMatches(node.token.children ?? [], query)
    } else {
      total += countMarkdownBlockMatches(node, query)
    }
  }
  return total
}

function countTableMatches(node: MarkdownNode, query: string): number {
  const rows: MarkdownNode[][] = []
  const collectRows = (list: readonly MarkdownNode[]) => {
    for (const child of list) {
      if (child.token.type === 'tr_open') {
        rows.push(child.children.filter(cell => cell.token.type === 'th_open' || cell.token.type === 'td_open'))
      } else {
        collectRows(child.children)
      }
    }
  }
  collectRows(node.children)
  let total = 0
  for (const row of rows) {
    for (const cell of row) {
      total += countInlineChildrenMatches(cell.children, query)
    }
  }
  return total
}

export function countMarkdownBlockMatches(node: MarkdownNode, query: string): number {
  const { token, children } = node
  if (token.type === 'math_block' || token.type === 'hr') return 0
  if (token.type === 'paragraph_open' || token.type === 'heading_open') {
    return countInlineChildrenMatches(children, query)
  }
  if (token.type === 'fence' || token.type === 'code_block') {
    const lang = token.type === 'fence' ? token.info.trim().split(/\s+/u)[0] : undefined
    if (lang?.toLowerCase() === 'mermaid') return 0
    const cleanCode = (token.content || '').replace(/\n+$/u, '')
    return countTextMatches(cleanCode, query)
  }
  if (token.type === 'blockquote_open') {
    const callout = parseCalloutNode(node)
    if (callout) {
      return countTextMatches(callout.title, query) + countMarkdownNodesMatches(callout.children, query)
    }
    const rawQuote = children.map(extractBlockText).filter(Boolean).join('\n').trim()
    if (rawQuote.startsWith('“') || rawQuote.startsWith('"')) {
      return 0
    }
    return countMarkdownNodesMatches(children, query)
  }
  if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
    let total = 0
    for (const child of children) {
      if (child.token.type !== 'list_item_open') {
        total += countMarkdownBlockMatches(child, query)
      } else {
        total += countMarkdownNodesMatches(getTaskInfo(child).children, query)
      }
    }
    return total
  }
  if (token.type === 'table_open') {
    return countTableMatches(node, query)
  }
  if (token.type === 'inline') {
    return countInlineTokensMatches(token.children ?? [], query)
  }
  if (children.length > 0) {
    return countMarkdownNodesMatches(children, query)
  }
  if (token.content.length > 0) {
    return countTextMatches(token.content, query)
  }
  return 0
}

export function countMarkdownNodesMatches(nodes: readonly MarkdownNode[], query: string): number {
  let total = 0
  for (const node of nodes) {
    total += countMarkdownBlockMatches(node, query)
  }
  return total
}

export function extractUserSearchBody(
  item: ChatMessage,
): { kind: 'heartbeat' | 'quotes' | 'markdown'; text: string } | undefined {
  if (item.role !== 'user') return undefined
  const parsedHandoff = parseHandoffMessage(item.text)
  const heartbeatBody = parsedHandoff === undefined ? heartbeatMessageBody(item.text, 'user') : undefined
  if (heartbeatBody !== undefined) {
    return { kind: 'heartbeat', text: heartbeatBody }
  }
  const effectiveMessageText = parsedHandoff !== undefined ? parsedHandoff.instruction : item.text
  const { quotes, body } = parseMessageQuotes(effectiveMessageText)
  const extracted = extractUserSubmittedFiles(body, item.files)
  const displayBody = extracted.displayText
  if (!hasVisibleMessageText(displayBody)) return undefined
  return {
    kind: quotes.length > 0 ? 'quotes' : 'markdown',
    text: displayBody,
  }
}

export function countUserMessageMatches(
  item: ChatMessage,
  query: string,
  parseBlocks: (text: string) => MarkdownNode[],
): number {
  const target = extractUserSearchBody(item)
  if (target === undefined) return 0
  if (target.kind === 'heartbeat') {
    return countMarkdownNodesMatches(parseBlocks(target.text), query)
  }
  if (target.text.length > USER_MESSAGE_INLINE_LIMIT) {
    return countPagedUserMatches(target.text, query)
  }
  if (target.kind === 'quotes') {
    return countTextMatches(target.text, query)
  }
  return countMarkdownNodesMatches(parseBlocks(target.text), query)
}

export function countAssistantMessageMatches(
  item: ChatMessage,
  query: string,
  parseBlocks: (text: string) => MarkdownNode[],
): number {
  if (!hasVisibleMessageText(item.text)) return 0
  const body = heartbeatMessageBody(item.text, 'assistant')
  if (body !== undefined) {
    return countMarkdownNodesMatches(parseBlocks(body), query)
  }
  return countMarkdownNodesMatches(parseBlocks(item.text), query)
}

export function countChatMessageMatches(
  item: ChatMessage,
  query: string,
  parseBlocks: (text: string) => MarkdownNode[],
): number {
  if (item.role === 'user') return countUserMessageMatches(item, query, parseBlocks)
  if (item.role === 'assistant') return countAssistantMessageMatches(item, query, parseBlocks)
  return hasVisibleMessageText(item.text) ? countMarkdownNodesMatches(parseBlocks(item.text), query) : 0
}

export function countDisplaySectionMatches(
  section: DisplayChatSection,
  query: string,
  parseBlocks: (text: string) => MarkdownNode[],
): number {
  if (section.kind === 'markdown-chunk') {
    return countMarkdownNodesMatches(section.nodes, query)
  }
  if (section.kind === 'process' || section.kind === 'process-prefix') {
    const segments = processSegments(section.items)
    const lastResponseIndex = segments.map(segment => segment.kind).lastIndexOf('response')
    const hiddenId = section.kind === 'process-prefix' ? section.hiddenResponseItemId : undefined
    let total = 0
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i]!
      if (segment.kind !== 'response') continue
      if (hiddenId !== undefined && segment.item.id === hiddenId && i === lastResponseIndex) continue
      total += countChatMessageMatches(segment.item, query, parseBlocks)
    }
    return total
  }
  if (section.item.kind !== 'message') return 0
  return countChatMessageMatches(section.item, query, parseBlocks)
}

export function buildChatSearchIndex(
  sections: readonly DisplayChatSection[],
  query: string,
  parseBlocks: (text: string) => MarkdownNode[],
): ChatSearchIndex {
  const normalized = normalizeSearchQuery(query)
  const matches: ChatSearchMatch[] = []
  const countBySectionKey = new Map<string, number>()
  if (normalized.length === 0) {
    return { query: normalized, matches, countBySectionKey }
  }
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex]!
    const count = countDisplaySectionMatches(section, normalized, parseBlocks)
    if (count <= 0) continue
    countBySectionKey.set(section.key, count)
    for (let localIndex = 0; localIndex < count; localIndex += 1) {
      matches.push({
        sectionKey: section.key,
        sectionIndex,
        localIndex,
      })
    }
  }
  return { query: normalized, matches, countBySectionKey }
}

export function resolveInitialSearchIndex(matchCount: number): number {
  return matchCount > 0 ? matchCount - 1 : -1
}

export function clampSearchIndex(current: number, matchCount: number): number {
  if (matchCount <= 0) return -1
  if (current < 0) return matchCount - 1
  if (current >= matchCount) return matchCount - 1
  return current
}

export function resolveNextSearchIndex(
  current: number,
  matchCount: number,
  direction: 'prev' | 'next',
): number {
  if (matchCount <= 0) return -1
  if (current < 0 || current >= matchCount) return direction === 'prev' ? matchCount - 1 : 0
  if (direction === 'prev') {
    return current === 0 ? matchCount - 1 : current - 1
  }
  return current === matchCount - 1 ? 0 : current + 1
}
