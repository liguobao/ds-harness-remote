import { strings } from '../locales/i18n'
import { ChatImageView } from './chat-image'
import { chatImageWorkspacePath, markdownImageSource } from '../services/chat-image-loader'
import { createContext, memo, useContext, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'
import { installMath } from './markdown-math'
import { MathFormula } from './math-formula'
import { MermaidBlock } from './mermaid/mermaid-block'
import { useTheme } from './theme-context'
import type { ThemeColors } from './theme-context'
import { getCachedThemedStyles } from './use-themed-styles'
import { CodeBlockView, type CodeBlockSearchHighlight } from './code-block'
import { PresentedFileGroup } from './file-card'
import { QuotePreview } from './quote-preview'
import { DshLinkIcon, classifyDshLinkPath } from './dsh-icons'
import {
  allocateBlockSearchHighlight,
  countInlineChildrenMatches,
  countMarkdownNodesMatches,
  countTextMatches,
  normalizeSearchQuery,
  splitHighlightRuns,
  type BlockSearchHighlight,
  type SearchHighlightState,
} from '../screens/chat/chat-search'

import {
  createMarkdownParser,
  decodeSessionMentionUri,
  markdownFilePath,
  classifyMarkdownLink,
  openSafeExternalUrl,
} from './link-helpers'

export { decodeSessionMentionUri, markdownFilePath, classifyMarkdownLink, openSafeExternalUrl }

import {
  type MarkdownNode,
  type TaskItemInfo,
  type CalloutInfo,
  getTaskInfo,
  detectAndStripTask,
  parseCalloutNode,
  parseCallout,
  headingStyle,
  createMarkdownStyles,
} from './markdown-helpers'

export {
  type MarkdownNode,
  type TaskItemInfo,
  type CalloutInfo,
  getTaskInfo,
  detectAndStripTask,
  parseCalloutNode,
  parseCallout,
}

// Remote messages are untrusted E2EE business content. Parse Markdown without
// raw HTML and render native Text/View/SVG nodes: no WebView or remote image requests.
// Linkify is enabled so bare URLs in AI responses can be navigated safely.
export const parser = createMarkdownParser()

type MarkdownLinkHandler = (href: string) => void
const markdownLinkContext = createContext<MarkdownLinkHandler | undefined>(undefined)
const workspaceFilePressContext = createContext<((path: string) => void) | undefined>(undefined)
const workspaceStatReadyContext = createContext(true)

export function useMarkdownLink(): MarkdownLinkHandler | undefined {
  return useContext(markdownLinkContext)
}

export function useWorkspaceFilePress(): ((path: string) => void) | undefined {
  const filePress = useContext(workspaceFilePressContext)
  const linkPress = useContext(markdownLinkContext)
  return filePress ?? linkPress
}

export function useWorkspaceStatReady(): boolean {
  return useContext(workspaceStatReadyContext)
}

const markdownFileContext = createContext<string | undefined>(undefined)

function MarkdownImage({ src, alt }: { src: string; alt: string }) {
  const file = useContext(markdownFileContext)
  const uri = markdownImageSource(src, file)
  return uri === undefined ? <Text>{`[${alt}]`}</Text> : <ChatImageView image={{ uri, name: alt }} remoteSource />
}

const markdownTextContext = createContext<((text: string) => string) | undefined>(undefined)

export function MarkdownLinkProvider({ onLinkPress, onFilePress, canStatFiles = true, transformText, children }: {
  onLinkPress?: MarkdownLinkHandler; onFilePress?: (path: string) => void; canStatFiles?: boolean; transformText?: (text: string) => string; children: ReactNode
}) {
  return (
    <markdownLinkContext.Provider value={onLinkPress}>
      <workspaceFilePressContext.Provider value={onFilePress}>
        <workspaceStatReadyContext.Provider value={canStatFiles}>
          <markdownTextContext.Provider value={transformText}>{children}</markdownTextContext.Provider>
        </workspaceStatReadyContext.Provider>
      </workspaceFilePressContext.Provider>
    </markdownLinkContext.Provider>
  )
}

/**
 * One message's markdown render: memoized per text and parsed incrementally
 * while the text only grows (streaming appends). Mirrors the DSH web client's
 * keying-by-closed-block strategy — already-closed blocks keep both their parse
 * result and their rendered element, so per-chunk work is O(tail) instead of
 * O(whole message).
 */
const referencedFilesCache = new WeakMap<MarkdownNode[], { path: string; name?: string }[]>()

export function extractReferencedFiles(nodes: MarkdownNode[]): { path: string; name?: string }[] {
  const cached = referencedFilesCache.get(nodes)
  if (cached !== undefined) return cached

  const files: { path: string; name?: string }[] = []
  const seen = new Set<string>()

  function walk(list: MarkdownNode[]) {
    for (const node of list) {
      if (node.token.type === 'fence' || node.token.type === 'code_block' || node.token.type === 'html') continue
      if (node.token.type === 'inline' && node.token.children) {
        const children = node.token.children
        for (let i = 0; i < children.length; i += 1) {
          const child = children[i]!
          if (child.type === 'link_open') {
            const href = child.attrGet('href')
            const path = href ? markdownFilePath(href) : undefined
            if (path && !seen.has(path)) {
              seen.add(path)
              let label = ''
              for (let j = i + 1; j < children.length && children[j]!.type !== 'link_close'; j += 1) {
                if (children[j]!.content) label += children[j]!.content
              }
              files.push({ path, name: label || undefined })
            }
          }
        }
      }
      if (node.children.length > 0) walk(node.children)
    }
  }
  walk(nodes)
  referencedFilesCache.set(nodes, files)
  return files
}

const EMPTY_REFERENCED_FILES: { path: string; name?: string }[] = []

export const NativeMarkdown = memo(function NativeMarkdown({
  text,
  colors: palette,
  sourceFile,
  preparsedNodes,
  suppressReferencedFiles = false,
  referencedFilesOverride,
  searchHighlight,
}: {
  text: string
  colors?: ThemeColors
  sourceFile?: string
  preparsedNodes?: readonly MarkdownNode[]
  suppressReferencedFiles?: boolean
  referencedFilesOverride?: readonly { path: string; name?: string }[]
  searchHighlight?: SearchHighlightState
}) {
  const theme = useTheme()
  // A caller can paint one block on a dark surface (a user bubble) without touching the theme.
  const colors = palette ?? theme.colors
  const onLinkPress = useContext(markdownLinkContext)
  const transformText = useContext(markdownTextContext)
  // `preparsedNodes` represents a caller-sliced block AST (e.g. a virtualized
  // chunk); never fall back to re-parsing `text` when it is supplied, or every
  // chunk would duplicate the entire message under a `transformText` provider.
  const usePreparsed = preparsedNodes !== undefined
  const source = useMemo(() => (usePreparsed ? '' : (transformText?.(text) ?? text)), [usePreparsed, text, transformText])
  const styles = useMemo(() => getCachedThemedStyles(createStyles, colors, theme.appearance), [colors, theme.appearance])
  const cacheRef = useRef<BlockParseCache | undefined>(undefined)
  // Normalize CR / CRLF to LF
  const nodes = useMemo(
    () => (usePreparsed ? preparsedNodes! : parseMarkdownBlocks(source, cacheRef)),
    [usePreparsed, preparsedNodes, source],
  )
  const referencedFiles = useMemo(() => {
    if (suppressReferencedFiles) return EMPTY_REFERENCED_FILES
    if (referencedFilesOverride !== undefined) return referencedFilesOverride as { path: string; name?: string }[]
    return extractReferencedFiles(nodes as MarkdownNode[])
  }, [suppressReferencedFiles, referencedFilesOverride, nodes])

  const normalizedQuery = searchHighlight === undefined ? '' : normalizeSearchQuery(searchHighlight.query)
  const activeSearch: ActiveMarkdownSearch | undefined = normalizedQuery.length > 0
    ? {
        query: normalizedQuery,
        activeLocalIndex: searchHighlight!.activeLocalIndex,
        counter: { current: 0 },
      }
    : undefined

  return (
    <markdownFileContext.Provider value={sourceFile}>
      <View style={styles.container}>
        {activeSearch === undefined
          ? nodes.map(node => renderBlockCached(node, styles, colors, onLinkPress))
          : nodes.map(node => renderBlock(node, styles, colors, onLinkPress, activeSearch))}
        {!suppressReferencedFiles && <PresentedFileGroup files={referencedFiles} onFilePress={onLinkPress} />}
      </View>
    </markdownFileContext.Provider>
  )
})

export interface BlockParseCache {
  text: string
  nodes: MarkdownNode[]
  /** Char offset of the last top-level block's first line inside `text` (-1 when unknown). */
  tailStart: number
  /** Key of the last top-level block; suffix re-parses continue numbering from it. */
  tailKey: number
}

export const MAX_MARKDOWN_CACHE_ENTRIES = 192
export const MAX_MARKDOWN_CACHE_TEXT_LEN = 32_768
const parsedBlocksCache = new Map<string, MarkdownNode[]>()

function readParsedBlocksCache(text: string): MarkdownNode[] | undefined {
  const cached = parsedBlocksCache.get(text)
  if (cached === undefined) return undefined
  parsedBlocksCache.delete(text)
  parsedBlocksCache.set(text, cached)
  return cached
}

function writeParsedBlocksCache(text: string, nodes: MarkdownNode[]): void {
  if (text.length > MAX_MARKDOWN_CACHE_TEXT_LEN) return
  if (parsedBlocksCache.has(text)) {
    parsedBlocksCache.delete(text)
  } else if (parsedBlocksCache.size >= MAX_MARKDOWN_CACHE_ENTRIES) {
    const oldest = parsedBlocksCache.keys().next().value
    if (oldest !== undefined) parsedBlocksCache.delete(oldest)
  }
  parsedBlocksCache.set(text, nodes)
}

/**
 * Reference definitions can change earlier blocks, including when first added
 * in the tail. Their marker also covers indented/nested and multiline labels;
 * conservatively reparse the whole message whenever it occurs.
 */
const LINK_REF_DEFINITION = /\]:/u

function lineStartsOf(text: string): number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1)
  }
  return starts
}

function tailStartOf(source: string, nodes: MarkdownNode[], base: number): number {
  const last = nodes.at(-1)
  const line = last?.token.map?.[0]
  if (last === undefined || line === undefined) return -1
  if (line === 0) return base
  return base + (lineStartsOf(source)[line] ?? -1)
}

/**
 * Block-parse `text`, reusing the previous parse when the change is a pure
 * append. Block parsing is line-deterministic, so every top-level block before
 * the last one is already closed and byte-identical; only the last block (which
 * the append may extend) plus the new tail are re-parsed, with keys identical
 * to what a full parse would produce. Edits, shrunken text, or prefixes with
 * link reference definitions fall back to a full parse.
 */
function parseBlocks(cacheRef: { current: BlockParseCache | undefined }, text: string): MarkdownNode[] {
  const cache = cacheRef.current
  if (cache !== undefined && cache.text === text) return cache.nodes
  if (cache !== undefined && cache.tailStart >= 0 && cache.tailKey >= 0
    && text.length > cache.text.length && text.startsWith(cache.text)
    && !LINK_REF_DEFINITION.test(text)
    // An unfinished display formula can span previously parsed paragraphs.
    && !/\$\$|\\\[/u.test(text)) {
    const suffix = text.slice(cache.tailStart)
    const suffixNodes = markdownTree(parser.parse(suffix, {}), cache.tailKey)
    const nodes = [...cache.nodes.slice(0, -1), ...suffixNodes]
    cacheRef.current = {
      text,
      nodes,
      tailStart: tailStartOf(suffix, suffixNodes, cache.tailStart),
      tailKey: suffixNodes.at(-1)?.key ?? cache.tailKey,
    }
    return nodes
  }
  if (text.length <= MAX_MARKDOWN_CACHE_TEXT_LEN) {
    const cached = readParsedBlocksCache(text)
    if (cached !== undefined) {
      cacheRef.current = {
        text,
        nodes: cached,
        tailStart: tailStartOf(text, cached, 0),
        tailKey: cached.at(-1)?.key ?? -1,
      }
      return cached
    }
  }
  const nodes = markdownTree(parser.parse(text, {}))
  writeParsedBlocksCache(text, nodes)
  cacheRef.current = { text, nodes, tailStart: tailStartOf(text, nodes, 0), tailKey: nodes.at(-1)?.key ?? -1 }
  return nodes
}

export function parseMarkdownBlocks(
  text: string,
  cacheRef: { current: BlockParseCache | undefined } = { current: undefined },
): MarkdownNode[] {
  return parseBlocks(cacheRef, text.replace(/\r\n?/g, '\n'))
}

/**
 * Rendered-element cache keyed by block node: block objects carried over from
 * the incremental parse return their previous element, so React bails out of
 * the whole closed-block subtree instead of re-rendering it per chunk.
 */
interface ActiveMarkdownSearch {
  query: string
  activeLocalIndex: number | null
  counter: { current: number }
}

function renderSearchHighlightedRuns(
  text: string,
  search: ActiveMarkdownSearch | undefined,
  keyPrefix: string,
): ReactNode {
  if (search === undefined || text.length === 0) return text
  const runs = splitHighlightRuns(text, search.query)
  if (runs.length === 1 && runs[0]!.matchOffset === null) return text
  return runs.map((run, idx) => {
    if (run.matchOffset === null) return run.text
    const localIndex = search.counter.current++
    const isActive = search.activeLocalIndex === localIndex
    return (
      <Text
        key={`${keyPrefix}:hl:${localIndex}:${idx}`}
        style={{
          backgroundColor: isActive ? '#F59E0B' : '#FEF08A',
          color: '#0F0F0F',
          fontWeight: isActive ? '700' : undefined,
        }}
      >
        {run.text}
      </Text>
    )
  })
}

function CalloutCard({
  callout,
  children,
  styles,
  colors,
  onLinkPress,
  searchHighlight,
  keyPrefix,
}: {
  callout: { type: CalloutInfo['type']; title: string }
  children: MarkdownNode[]
  styles: MarkdownStyles
  colors: ThemeColors
  onLinkPress?: MarkdownLinkHandler
  searchHighlight?: BlockSearchHighlight
  keyPrefix?: string
}) {
  const isWarning = callout.type === 'WARNING' || callout.type === 'CAUTION'
  const isTip = callout.type === 'TIP'
  const accentColor = isWarning ? colors.warning : isTip ? colors.success : colors.primary
  const bgColor = isWarning ? colors.warningSoft : colors.surfaceStrong
  const borderColor = isWarning ? colors.warning : colors.border
  const localSearch: ActiveMarkdownSearch | undefined = searchHighlight
    ? {
      query: searchHighlight.query,
      activeLocalIndex: searchHighlight.activeLocalIndex,
      counter: { current: searchHighlight.baseIndex },
    }
    : undefined
  const renderedTitle = renderSearchHighlightedRuns(callout.title, localSearch, `${keyPrefix ?? 'callout'}:title`)

  return (
    <View style={[styles.calloutCard, { backgroundColor: bgColor, borderColor }]}>
      <View style={styles.calloutHeader}>
        <View style={[styles.calloutIconWrap, { backgroundColor: accentColor }]}>
          <Svg width={12} height={12} viewBox="0 0 16 16" fill="none">
            {isWarning ? (
              <Path d="M8 2L14.5 13.5H1.5L8 2ZM8 6.5V9.5M8 11.5V12" stroke="#FFFFFF" strokeWidth={1.8} strokeLinecap="round" />
            ) : (
              <Path d="M8 2C4.686 2 2 4.686 2 8s2.686 6 6 6 6-2.686 6-6-2.686-6-6-6zm0 3a1 1 0 110 2 1 1 0 010-2zm0 3v4" stroke="#FFFFFF" strokeWidth={1.8} strokeLinecap="round" />
            )}
          </Svg>
        </View>
        <Text style={[styles.calloutTitle, { color: colors.ink }]}>{renderedTitle}</Text>
      </View>
      {children.length > 0 && (
        <View style={styles.calloutBodyContainer}>
          {children.map(child => renderBlock(child, styles, colors, onLinkPress, localSearch))}
        </View>
      )}
    </View>
  )
}

const renderedBlocks = new WeakMap<MarkdownNode, { styles: MarkdownStyles; colors: ThemeColors; onLinkPress: MarkdownLinkHandler | undefined; element: ReactNode }>()

function renderBlockCached(node: MarkdownNode, styles: MarkdownStyles, colors: ThemeColors, onLinkPress: MarkdownLinkHandler | undefined): ReactNode {
  const cached = renderedBlocks.get(node)
  if (cached !== undefined && cached.styles === styles && cached.colors === colors && cached.onLinkPress === onLinkPress) return cached.element
  const element = renderBlock(node, styles, colors, onLinkPress)
  renderedBlocks.set(node, { styles, colors, onLinkPress, element })
  return element
}

function markdownTree(tokens: Token[], keyOffset = 0): MarkdownNode[] {
  if (tokens.length === 0) return []
  const root: MarkdownNode = { key: keyOffset - 1, token: tokens[0]!, children: [] }
  const stack = [root]
  tokens.forEach((token, key) => {
    if (token.nesting === -1) {
      if (stack.length > 1) stack.pop()
      return
    }
    const node = { key: keyOffset + key, token, children: [] } satisfies MarkdownNode
    stack.at(-1)!.children.push(node)
    if (token.nesting === 1) stack.push(node)
  })
  return root.children
}

type MarkdownStyles = ReturnType<typeof createStyles>

function extractBlockText(node: MarkdownNode): string {
  if (node.token.content) return node.token.content
  return node.children.map(extractBlockText).filter(Boolean).join('\n')
}

/** Fullwidth/CJK code units measure ~1 em; other units ~0.55 em at body size. */
function isFullwidthCodeUnit(code: number): boolean {
  return (code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe4f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
}

/**
 * Markdown tables render as native rows. Column edges must line up across
 * rows, so every row shares one width plan derived from the table's cells:
 * with per-row sizing, a long unbreakable cell pushes only its own row wider
 * and column boundaries drift apart between rows. Cells take a plain `width`
 * — no flex properties — so a column cannot vary between rows. Long text
 * wraps inside its fixed column; when the plan exceeds the viewport the outer
 * horizontal ScrollView takes over, and when it is narrower the plan scales
 * up proportionally to fill the width.
 */
const MaxColumnWidth = 260

function renderTable(
  node: MarkdownNode,
  styles: MarkdownStyles,
  colors: ThemeColors,
  onLinkPress?: MarkdownLinkHandler,
  search?: ActiveMarkdownSearch,
): ReactNode {
  const rows: MarkdownNode[][] = []
  const collectRows = (list: MarkdownNode[]) => {
    for (const child of list) {
      if (child.token.type === 'tr_open') {
        rows.push(child.children.filter(cell => cell.token.type === 'th_open' || cell.token.type === 'td_open'))
      } else {
        collectRows(child.children)
      }
    }
  }
  collectRows(node.children)

  const fontSize = (styles.tableText.fontSize as number | undefined) ?? 13
  const cellPadding = ((styles.tableCell.paddingHorizontal as number | undefined) ?? 12) * 2 + 2
  const minCellWidth = (styles.tableCell.minWidth as number | undefined) ?? 96
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const columnWidths: number[] = []
  for (let column = 0; column < columnCount; column += 1) {
    let widest = 0
    for (const row of rows) {
      const cell = row[column]
      if (cell === undefined) continue
      const text = extractBlockText(cell).replace(/\s+/gu, ' ').trim()
      if (text.length === 0) continue
      let units = 0
      for (let index = 0; index < text.length; index += 1) {
        units += isFullwidthCodeUnit(text.charCodeAt(index)) ? 1 : 0.55
      }
      widest = Math.max(widest, Math.ceil(units * fontSize) + cellPadding)
    }
    columnWidths.push(Math.min(MaxColumnWidth, Math.max(minCellWidth, widest)))
  }

  let cellBases: number[][] | undefined
  let tableSearchQuery: string | undefined
  let tableActiveLocalIndex: number | null | undefined
  if (search !== undefined) {
    const startCount = search.counter.current
    const bases: number[][] = rows.map(row =>
      row.map(cell => {
        const base = search.counter.current
        search.counter.current += countInlineChildrenMatches(cell.children, search.query)
        return base
      }),
    )
    if (search.counter.current > startCount) {
      cellBases = bases
      tableSearchQuery = search.query
      tableActiveLocalIndex = search.activeLocalIndex
    }
  }

  return (
    <MarkdownTable
      key={node.key}
      plan={columnWidths}
      minCellWidth={minCellWidth}
      rows={rows}
      styles={styles}
      colors={colors}
      onLinkPress={onLinkPress}
      searchQuery={tableSearchQuery}
      activeLocalIndex={tableActiveLocalIndex}
      cellBases={cellBases}
    />
  )
}

const MarkdownTable = memo(function MarkdownTable({
  plan,
  minCellWidth,
  rows,
  styles,
  colors,
  onLinkPress,
  searchQuery,
  activeLocalIndex,
  cellBases,
}: {
  plan: number[]
  minCellWidth: number
  rows: MarkdownNode[][]
  styles: MarkdownStyles
  colors: ThemeColors
  onLinkPress?: MarkdownLinkHandler
  searchQuery?: string
  activeLocalIndex?: number | null
  cellBases?: number[][]
}) {
  // Fill the viewport when the plan is narrower; overflow keeps plan widths and scrolls.
  const [viewportWidth, setViewportWidth] = useState(0)
  const planTotal = plan.reduce((sum, width) => sum + width, 0)
  const fillScale = viewportWidth > planTotal && planTotal > 0 ? viewportWidth / planTotal : 1

  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tableScrollContent}
      style={styles.tableContainer}
      onLayout={event => {
        const nextWidth = event.nativeEvent.layout.width
        setViewportWidth(prev => (
          (nextWidth > planTotal || prev > planTotal) && Math.abs(nextWidth - prev) > 1
            ? nextWidth
            : prev
        ))
      }}
    >
      <View style={styles.table}>
        {rows.map((row, rowIndex) => (
          <View key={`md-table-row-${row[0]?.key ?? rowIndex}`} style={styles.tableRow}>
            {row.map((cell, column) => {
              const isHeader = cell.token.type === 'th_open'
              const cellSearch: ActiveMarkdownSearch | undefined =
                searchQuery !== undefined && cellBases !== undefined
                  ? {
                      query: searchQuery,
                      activeLocalIndex: activeLocalIndex ?? null,
                      counter: { current: cellBases[rowIndex]?.[column] ?? 0 },
                    }
                  : undefined
              return (
                <View
                  key={cell.key}
                  style={[styles.tableCell, { width: (plan[column] ?? minCellWidth) * fillScale }, isHeader && styles.tableHeader]}
                >
                  <Text style={isHeader ? styles.tableHeaderText : styles.tableText}>
                    {renderInlineChildren(cell.children, styles, colors, onLinkPress, cellSearch)}
                  </Text>
                </View>
              )
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  )
})

function renderBlock(
  node: MarkdownNode,
  styles: MarkdownStyles,
  colors: ThemeColors,
  onLinkPress?: MarkdownLinkHandler,
  search?: ActiveMarkdownSearch,
): ReactNode {
  const { token, key, children } = node
  if (token.type === 'math_block') return <MathFormula key={key} source={token.content} display />
  if (token.type === 'paragraph_open') {
    return <Text key={key} selectable style={styles.paragraph}>{renderInlineChildren(children, styles, colors, onLinkPress, search)}</Text>
  }
  if (token.type === 'heading_open') {
    return <Text key={key} selectable style={[styles.heading, headingStyle(token.tag, styles)]}>{renderInlineChildren(children, styles, colors, onLinkPress, search)}</Text>
  }
  if (token.type === 'fence' || token.type === 'code_block') {
    const lang = token.type === 'fence' ? token.info.trim().split(/\s+/u)[0] : undefined
    if (lang?.toLowerCase() === 'mermaid') return <MermaidBlock key={key} code={token.content} />
    const cleanCode = (token.content || '').replace(/\n+$/u, '')
    const codeHighlight: CodeBlockSearchHighlight | undefined = search !== undefined
      ? allocateBlockSearchHighlight(countTextMatches(cleanCode, search.query), search)
      : undefined
    return <CodeBlockView key={key} code={token.content} language={lang} searchHighlight={codeHighlight} />
  }
  if (token.type === 'blockquote_open') {
    const callout = parseCalloutNode(node)
    if (callout) {
      const calloutHighlight = search !== undefined
        ? allocateBlockSearchHighlight(
          countTextMatches(callout.title, search.query) + countMarkdownNodesMatches(callout.children, search.query),
          search,
        )
        : undefined
      return (
        <CalloutCard
          key={key}
          callout={callout}
          children={callout.children}
          styles={styles}
          colors={colors}
          onLinkPress={onLinkPress}
          searchHighlight={calloutHighlight}
          keyPrefix={`callout:${key}`}
        />
      )
    }
    const rawQuote = children.map(extractBlockText).filter(Boolean).join('\n').trim()
    if (rawQuote.startsWith('“') || rawQuote.startsWith('"')) {
      return (
        <QuotePreview
          key={key}
          text={rawQuote}
          style={styles.blockquotePreview}
        />
      )
    }
    return (
      <View key={key} style={styles.blockquote}>
        {children.map(child => renderBlock(child, styles, colors, onLinkPress, search))}
      </View>
    )
  }
  if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
    const ordered = token.type === 'ordered_list_open'
    const start = Number(token.attrGet('start') ?? '1')
    return (
      <View key={key} style={styles.list}>
        {children.map((child, index) => renderListItem(child, styles, colors, ordered ? start + index : undefined, onLinkPress, search))}
      </View>
    )
  }
  if (token.type === 'hr') return <View key={key} style={styles.rule} />
  if (token.type === 'table_open') return renderTable(node, styles, colors, onLinkPress, search)
  if (token.type === 'inline') return <Text key={key} selectable style={styles.paragraph}>{renderInline(token.children ?? [], styles, `block:${key}`, onLinkPress, search)}</Text>
  if (children.length > 0) return <View key={key}>{children.map(child => renderBlock(child, styles, colors, onLinkPress, search))}</View>
  if (token.content.length > 0) return <Text key={key} selectable style={styles.paragraph}>{renderSearchHighlightedRuns(token.content, search, `block:${key}`)}</Text>
  return null
}

function renderListItem(
  node: MarkdownNode,
  styles: MarkdownStyles,
  colors: ThemeColors,
  number?: number,
  onLinkPress?: MarkdownLinkHandler,
  search?: ActiveMarkdownSearch,
): ReactNode {
  if (node.token.type !== 'list_item_open') return renderBlock(node, styles, colors, onLinkPress, search)
  const task = getTaskInfo(node)
  return (
    <View key={node.key} style={styles.listItem}>
      {task.isTask ? (
        task.checked ? (
          <View
            accessibilityRole="checkbox"
            accessibilityState={{ checked: true, disabled: true }}
            accessibilityLabel={strings.common.taskComplete}
            style={[styles.checkboxChecked, { backgroundColor: colors.primary }]}
          >
            <Svg width={10} height={10} viewBox="0 0 16 16" fill="none">
              <Path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </View>
        ) : (
          <View
            accessibilityRole="checkbox"
            accessibilityState={{ checked: false, disabled: true }}
            accessibilityLabel={strings.common.taskIncomplete}
            style={[styles.checkboxUnchecked, { borderColor: colors.subtle }]}
          />
        )
      ) : (
        <Text style={styles.listMarker}>{number === undefined ? '•' : `${number}.`}</Text>
      )}
      <View style={styles.listContent}>{task.children.map(child => renderBlock(child, styles, colors, onLinkPress, search))}</View>
    </View>
  )
}

function renderInlineChildren(
  nodes: MarkdownNode[],
  styles: MarkdownStyles,
  colors: ThemeColors,
  onLinkPress?: MarkdownLinkHandler,
  search?: ActiveMarkdownSearch,
): ReactNode[] {
  return nodes.flatMap(node => node.token.type === 'inline'
    ? renderInline(node.token.children ?? [], styles, `inline:${node.key}`, onLinkPress, search)
    : [renderBlock(node, styles, colors, onLinkPress, search)])
}

function renderInline(
  tokens: Token[],
  styles: MarkdownStyles,
  prefix: string,
  onLinkPress?: MarkdownLinkHandler,
  search?: ActiveMarkdownSearch,
): ReactNode[] {
  const output: ReactNode[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    const key = `${prefix}:${index}`
    if (token.type === 'math_inline') output.push(<MathFormula key={key} source={token.content} />)
    else if (token.type === 'text') output.push(renderSearchHighlightedRuns(token.content, search, key))
    else if (token.type === 'softbreak' || token.type === 'hardbreak') output.push('\n')
    else if (token.type === 'code_inline') {
      const isMention = token.content.startsWith('/') || token.content.startsWith('@')
      output.push(<Text key={key} style={[styles.inlineCode, isMention && styles.mentionCode]}>{renderSearchHighlightedRuns(token.content, search, key)}</Text>)
    }
    else if (token.type === 'image') {
      const alt = token.content || token.children?.map(child => child.content).join('') || '图片'
      const src = token.attrGet('src') ?? ''
      output.push(src.startsWith('data:') || chatImageWorkspacePath(src) !== undefined
        ? <MarkdownImage key={key} src={src} alt={alt} />
        : <Text key={key} style={styles.imageAlt}>{`[${alt}]`}</Text>)
    } else if (token.nesting === 1) {
      const closing = findClosingToken(tokens, index)
      if (closing < 0) continue
      const innerTokens = tokens.slice(index + 1, closing)
      if (token.type === 'strong_open') output.push(<Text key={key} style={styles.strong}>{renderInline(innerTokens, styles, key, onLinkPress, search)}</Text>)
      else if (token.type === 'em_open') output.push(<Text key={key} style={styles.emphasis}>{renderInline(innerTokens, styles, key, onLinkPress, search)}</Text>)
      else if (token.type === 's_open') output.push(<Text key={key} style={styles.strike}>{renderInline(innerTokens, styles, key, onLinkPress, search)}</Text>)
      else if (token.type === 'link_open') {
        const href = token.attrGet('href') ?? ''
        const rawText = innerTokens.map(t => t.content).join('')
        const linkInfo = classifyMarkdownLink(href, rawText)
        const iconKind = linkInfo.iconKind
        const handlePress = !linkInfo.isBlocked && linkInfo.safeHref !== null
          ? () => {
              if (onLinkPress !== undefined) {
                onLinkPress(linkInfo.safeHref!)
              } else if (linkInfo.kind === 'external') {
                openSafeExternalUrl(linkInfo.safeHref!)
              }
            }
          : undefined

        if (linkInfo.isBlocked) {
          output.push(
            <Text
              key={key}
              style={styles.blockedLink}
              accessibilityRole="none"
              accessibilityLabel={`${rawText || href} (链接已被安全阻断)`}
            >
              {renderInline(innerTokens, styles, key, onLinkPress, search)}
            </Text>
          )
        } else if (linkInfo.kind === 'citation') {
          output.push(
            <Text
              key={key}
              style={styles.citationBadge}
              accessibilityRole={handlePress ? 'link' : 'none'}
              accessibilityLabel={`引用来源 [${linkInfo.citationIndex ?? rawText}]`}
              onPress={handlePress}
            >
              <Text style={styles.citationText}>
                {linkInfo.citationIndex
                  ? renderSearchHighlightedRuns(`[${linkInfo.citationIndex}]`, search, `${key}:cite`)
                  : renderInline(innerTokens, styles, key, onLinkPress, search)}
              </Text>
            </Text>
          )
        } else {
          output.push(
            <Text
              key={key}
              style={styles.link}
              accessibilityRole="link"
              accessibilityLabel={
                linkInfo.kind === 'external'
                  ? `${rawText || linkInfo.displayText}, 外部链接${linkInfo.domain ? ` (${linkInfo.domain})` : ''}`
                  : (linkInfo.fileLine ? `${rawText || linkInfo.filePath}, 第 ${linkInfo.fileLine} 行` : undefined)
              }
              onPress={handlePress}
            >
              {iconKind && (
                <View style={{ marginRight: 3, top: ['github', 'google', 'mdn', 'globe'].includes(iconKind) ? 2.5 : 1.8 }}>
                  <DshLinkIcon kind={iconKind} size={14} color={styles.link.color} />
                </View>
              )}
              {iconKind ? ' ' : ''}
              {linkInfo.kind === 'external' && linkInfo.displayText !== rawText && linkInfo.displayText.length > 0
                ? renderSearchHighlightedRuns(linkInfo.displayText, search, `${key}:disp`)
                : renderInline(innerTokens, styles, key, onLinkPress, search)}
            </Text>
          )
        }
      }
      else output.push(...renderInline(innerTokens, styles, key, onLinkPress, search))
      index = closing
    } else if (token.content.length > 0) output.push(renderSearchHighlightedRuns(token.content, search, key))
  }
  return output
}

function findClosingToken(tokens: Token[], opening: number): number {
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

export const createStyles = createMarkdownStyles
