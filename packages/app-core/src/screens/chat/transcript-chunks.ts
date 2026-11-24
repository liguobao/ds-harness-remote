import type { ChatSection } from '../../state/message-helpers'
import { hasVisibleMessageText } from '../../state/event-reducer'
import type { ChatItem, ChatMessage } from '../../types'
import { heartbeatMessageBody } from '../../ui/heartbeat-message'
import type { MarkdownNode } from '../../ui/markdown-helpers'
import { processSegments, shouldShowTurnResponseActions } from '../chat-process'

export interface ReferencedFileEntry {
  path: string
  name?: string
}

export interface ProcessPrefixSection {
  kind: 'process-prefix'
  key: string
  sourceKey: string
  turn: string | undefined
  items: ChatItem[]
  hiddenResponseItemId: string
}

export interface MarkdownChunkSection {
  kind: 'markdown-chunk'
  key: string
  /** Original ChatSection key (used for uiBySection artifact lookup & reading anchor recovery). */
  sourceKey: string
  turn: string | undefined
  /** Full original assistant ChatMessage (preserves Copy / Branch / TurnUsage / Feedback). */
  item: ChatMessage
  nodes: readonly MarkdownNode[]
  referencedFiles: readonly ReferencedFileEntry[]
  chunkIndex: number
  chunkCount: number
  chunkWeight: number
  compact: boolean
  showActions: boolean
  isProcessSection: boolean
  processItems?: ChatItem[]
}

export type DisplayChatSection = ChatSection | ProcessPrefixSection | MarkdownChunkSection

export const MIN_CHUNK_BLOCKS = 6
export const MIN_CHUNK_TOTAL_WEIGHT = 10
export const TARGET_CHUNK_WEIGHT = 6
const MIN_TAIL_CHUNK_WEIGHT = 3

/**
 * Rough native-view weight of one top-level Markdown block so tables and code
 * blocks don't pile into the same FlatList cell and stall Fabric mountViews.
 */
export function markdownNodeWeight(node: MarkdownNode): number {
  const type = node.token.type
  if (type === 'table_open') return 4
  if (type === 'fence' || type === 'code_block') return 4
  if (type === 'bullet_list_open' || type === 'ordered_list_open' || type === 'blockquote_open') {
    return Math.min(4, Math.max(2, Math.ceil(node.children.length / 2)))
  }
  return 1
}

export interface MarkdownNodeChunk {
  nodes: MarkdownNode[]
  weight: number
}

/**
 * Partition top-level Markdown blocks of a completed long assistant reply into
 * weighted chunks suitable for FlatList virtualization. Returns `undefined` for
 * short/medium replies that don't benefit from chunking.
 */
export function splitMarkdownNodesIntoChunks(nodes: readonly MarkdownNode[]): MarkdownNodeChunk[] | undefined {
  if (nodes.length < MIN_CHUNK_BLOCKS) return undefined
  const weights = nodes.map(markdownNodeWeight)
  let totalWeight = 0
  for (const w of weights) totalWeight += w
  if (totalWeight < MIN_CHUNK_TOTAL_WEIGHT) return undefined

  const chunks: MarkdownNodeChunk[] = []
  let currentNodes: MarkdownNode[] = []
  let currentWeight = 0

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!
    const w = weights[i]!
    if (currentNodes.length > 0 && currentWeight + w > TARGET_CHUNK_WEIGHT) {
      // Keep a trailing heading attached to the block that follows it.
      if (currentNodes.length > 1 && currentNodes[currentNodes.length - 1]!.token.type === 'heading_open') {
        const trailingHeading = currentNodes.pop()!
        const headingWeight = weights[i - 1]!
        chunks.push({ nodes: currentNodes, weight: currentWeight - headingWeight })
        currentNodes = [trailingHeading, node]
        currentWeight = headingWeight + w
      } else {
        chunks.push({ nodes: currentNodes, weight: currentWeight })
        currentNodes = [node]
        currentWeight = w
      }
    } else {
      currentNodes.push(node)
      currentWeight += w
    }
  }
  if (currentNodes.length > 0) {
    chunks.push({ nodes: currentNodes, weight: currentWeight })
  }

  // Avoid leaving a tiny trailing orphan chunk at the very bottom of the reply.
  if (chunks.length >= 2 && chunks[chunks.length - 1]!.weight < MIN_TAIL_CHUNK_WEIGHT) {
    const tail = chunks.pop()!
    const prev = chunks[chunks.length - 1]!
    prev.nodes = [...prev.nodes, ...tail.nodes]
    prev.weight += tail.weight
  }

  return chunks.length >= 2 ? chunks : undefined
}

function isActiveItem(item: ChatItem): boolean {
  if (item.turnEnd !== undefined) return false
  if (item.kind === 'message') return item.streaming === true
  if (item.kind === 'tool') return item.state === 'running'
  if (item.kind === 'approval' || item.kind === 'question') return item.outcome === undefined
  return false
}

export function isSectionLive(section: ChatSection, isLast: boolean, isSessionRunning: boolean): boolean {
  if (isLast && isSessionRunning) return true
  if (section.kind === 'item') return isActiveItem(section.item)
  return section.items.some(isActiveItem)
}

export interface ChunkTranscriptOptions {
  liveTurnKeys: ReadonlySet<string>
  isSessionRunning: boolean
  backend?: string
  parseBlocks: (text: string) => MarkdownNode[]
  extractFiles: (nodes: MarkdownNode[]) => ReferencedFileEntry[]
  cache?: WeakMap<ChatSection, readonly DisplayChatSection[]>
}

export function chunkTranscriptSections(
  sections: readonly ChatSection[],
  options: ChunkTranscriptOptions,
): DisplayChatSection[] {
  const { liveTurnKeys, isSessionRunning, backend, parseBlocks, extractFiles, cache } = options
  const out: DisplayChatSection[] = []

  for (let idx = 0; idx < sections.length; idx += 1) {
    const section = sections[idx]!
    const isLastSection = idx === sections.length - 1
    if (liveTurnKeys.has(section.key) || isSectionLive(section, isLastSection, isSessionRunning)) {
      out.push(section)
      continue
    }

    const cached = cache?.get(section)
    if (cached !== undefined) {
      for (const entry of cached) out.push(entry)
      continue
    }

    const expanded = expandCompletedSection(section, backend, parseBlocks, extractFiles)
    cache?.set(section, expanded)
    for (const entry of expanded) out.push(entry)
  }

  return out
}

function expandCompletedSection(
  section: ChatSection,
  backend: string | undefined,
  parseBlocks: (text: string) => MarkdownNode[],
  extractFiles: (nodes: MarkdownNode[]) => ReferencedFileEntry[],
): readonly DisplayChatSection[] {
  if (section.kind === 'item') {
    const item = section.item
    if (
      item.kind !== 'message'
      || item.role !== 'assistant'
      || item.streaming === true
      || !hasVisibleMessageText(item.text)
      || heartbeatMessageBody(item.text, 'assistant') !== undefined
    ) {
      return [section]
    }
    const allNodes = parseBlocks(item.text)
    const chunks = splitMarkdownNodesIntoChunks(allNodes)
    if (chunks === undefined) return [section]
    const referencedFiles = extractFiles(allNodes)
    return chunks.map((chunk, chunkIndex): MarkdownChunkSection => ({
      kind: 'markdown-chunk',
      key: chunkIndex === 0 ? section.key : `${section.key}#md:${chunkIndex}`,
      sourceKey: section.key,
      turn: item.turn,
      item,
      nodes: chunk.nodes,
      referencedFiles,
      chunkIndex,
      chunkCount: chunks.length,
      chunkWeight: chunk.weight,
      compact: false,
      showActions: true,
      isProcessSection: false,
    }))
  }

  // Process section: split only when the turn is settled and ends with a long assistant response.
  const items = section.items
  const last = items.at(-1)
  const hasActiveItem = items.some(isActiveItem)
  if (hasActiveItem) return [section]
  const codexClosed = backend === 'codex' && last?.kind === 'message' && last.role === 'assistant'
  const end = items.find(item => item.turnEnd !== undefined)?.turnEnd
    ?? (codexClosed ? { reason: 'completed' as const, time: 0 } : undefined)
  if (end === undefined) return [section]

  const segments = processSegments(items)
  const lastSeg = segments.at(-1)
  if (lastSeg === undefined || lastSeg.kind !== 'response') return [section]
  const responseItem = lastSeg.item
  if (
    responseItem.streaming === true
    || !hasVisibleMessageText(responseItem.text)
    || heartbeatMessageBody(responseItem.text, 'assistant') !== undefined
  ) {
    return [section]
  }

  const allNodes = parseBlocks(responseItem.text)
  const chunks = splitMarkdownNodesIntoChunks(allNodes)
  if (chunks === undefined) return [section]

  const referencedFiles = extractFiles(allNodes)
  const lastResponseIndex = segments.length - 1
  const showActions = shouldShowTurnResponseActions({
    segmentIndex: lastResponseIndex,
    lastResponseIndex,
    turnEnded: true,
    hasActiveItem: false,
    isTurnRunning: false,
  })

  const expanded: DisplayChatSection[] = [
    {
      kind: 'process-prefix',
      key: section.key,
      sourceKey: section.key,
      turn: section.turn,
      items,
      hiddenResponseItemId: responseItem.id,
    },
  ]
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex]!
    expanded.push({
      kind: 'markdown-chunk',
      key: `${section.key}#md:${chunkIndex}`,
      sourceKey: section.key,
      turn: section.turn,
      item: responseItem,
      nodes: chunk.nodes,
      referencedFiles,
      chunkIndex,
      chunkCount: chunks.length,
      chunkWeight: chunk.weight,
      compact: true,
      showActions,
      isProcessSection: true,
      processItems: items,
    })
  }
  return expanded
}

const CHUNK_SUFFIX_MARKER = '#md:'

/** Strip any `#md:<n>` chunk suffix to obtain the owning ChatSection key. */
export function baseSectionKey(key: string): string {
  const idx = key.indexOf(CHUNK_SUFFIX_MARKER)
  return idx >= 0 ? key.slice(0, idx) : key
}

/**
 * Resolve a persisted reading anchor across chunked/unchunked layouts:
 * exact key match first, then owning section key / first sibling chunk fallback.
 */
export function resolveReadingAnchorIndex(
  sections: readonly { key: string }[],
  savedKey: string | undefined,
): number {
  if (savedKey === undefined) return -1
  const exact = sections.findIndex(item => item.key === savedKey)
  if (exact >= 0) return exact
  const base = baseSectionKey(savedKey)
  const basePrefix = `${base}${CHUNK_SUFFIX_MARKER}`
  return sections.findIndex(item => item.key === base || item.key.startsWith(basePrefix))
}

/**
 * Compute initial tail window count for a bottom-aligned transcript.
 * When the tail ends in heavy markdown chunks, mount only enough chunks to fill
 * ~1 screen (accumulated weight >= 6) so heavy tables/code blocks above the fold
 * stay unmounted until the user scrolls up; short/unchunked transcripts keep `defaultLimit`.
 */
export function resolveInitialTailLimit(
  sections: readonly DisplayChatSection[],
  defaultLimit: number,
): number {
  const last = sections.at(-1)
  if (last === undefined || last.kind !== 'markdown-chunk') return defaultLimit
  let weight = 0
  let count = 0
  for (let i = sections.length - 1; i >= 0 && count < Math.max(defaultLimit, 3); i -= 1) {
    const row = sections[i]!
    const rowWeight = row.kind === 'markdown-chunk' ? row.chunkWeight : 2
    weight += rowWeight
    count += 1
    if (weight >= 6) break
  }
  return Math.max(1, count)
}
