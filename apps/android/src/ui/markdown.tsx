import { ChatImageView } from './chat-image'
import { chatImageWorkspacePath } from '../services/chat-image-loader'
import { createContext, memo, useContext, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'
import { radius, spacing, typeForDensity } from './theme'
import type { TypographyDensity } from './theme'
import { installMath } from './markdown-math'
import { MathFormula } from './math-formula'
import { useTheme } from './theme-context'
import type { ThemeColors } from './theme-context'
import { useThemedStyles } from './use-themed-styles'
import { CodeBlockView } from './code-block'
import { PresentedFileGroup } from './file-card'
import { QuotePreview } from './quote-preview'
import { DshLinkIcon, classifyDshLinkPath } from './dsh-icons'

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

export function useMarkdownLink(): MarkdownLinkHandler | undefined {
  return useContext(markdownLinkContext)
}

const markdownTextContext = createContext<((text: string) => string) | undefined>(undefined)

export function MarkdownLinkProvider({ onLinkPress, transformText, children }: {
  onLinkPress?: MarkdownLinkHandler; transformText?: (text: string) => string; children: ReactNode
}) {
  return <markdownLinkContext.Provider value={onLinkPress}><markdownTextContext.Provider value={transformText}>{children}</markdownTextContext.Provider></markdownLinkContext.Provider>
}

/**
 * One message's markdown render: memoized per text and parsed incrementally
 * while the text only grows (streaming appends). Mirrors the DSH web client's
 * keying-by-closed-block strategy — already-closed blocks keep both their parse
 * result and their rendered element, so per-chunk work is O(tail) instead of
 * O(whole message).
 */
function extractReferencedFiles(nodes: MarkdownNode[]): { path: string; name?: string }[] {
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
  return files
}

export const NativeMarkdown = memo(function NativeMarkdown({ text }: { text: string }) {
  const { colors } = useTheme()
  const onLinkPress = useContext(markdownLinkContext)
  const transformText = useContext(markdownTextContext)
  const source = useMemo(() => transformText?.(text) ?? text, [text, transformText])
  const styles = useThemedStyles(createStyles)
  const cacheRef = useRef<BlockParseCache | undefined>(undefined)
  // Normalize CR / CRLF to LF
  const nodes = useMemo(() => parseBlocks(cacheRef, source.replace(/\r\n?/g, "\n")), [source])
  const referencedFiles = useMemo(() => extractReferencedFiles(nodes), [nodes])

  return (
    <View style={styles.container}>
      {nodes.map(node => renderBlockCached(node, styles, colors, onLinkPress))}
      <PresentedFileGroup files={referencedFiles} onFilePress={onLinkPress} />
    </View>
  )
})

interface BlockParseCache {
  text: string
  nodes: MarkdownNode[]
  /** Char offset of the last top-level block's first line inside `text` (-1 when unknown). */
  tailStart: number
  /** Key of the last top-level block; suffix re-parses continue numbering from it. */
  tailKey: number
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
  const nodes = markdownTree(parser.parse(text, {}))
  cacheRef.current = { text, nodes, tailStart: tailStartOf(text, nodes, 0), tailKey: nodes.at(-1)?.key ?? -1 }
  return nodes
}

/**
 * Rendered-element cache keyed by block node: block objects carried over from
 * the incremental parse return their previous element, so React bails out of
 * the whole closed-block subtree instead of re-rendering it per chunk.
 */
function CalloutCard({
  callout,
  children,
  styles,
  colors,
  onLinkPress,
}: {
  callout: { type: CalloutInfo['type']; title: string }
  children: MarkdownNode[]
  styles: MarkdownStyles
  colors: ThemeColors
  onLinkPress?: MarkdownLinkHandler
}) {
  const isWarning = callout.type === 'WARNING' || callout.type === 'CAUTION'
  const isTip = callout.type === 'TIP'
  const accentColor = isWarning ? colors.warning : isTip ? colors.success : colors.primary
  const bgColor = isWarning ? colors.warningSoft : colors.surfaceStrong
  const borderColor = isWarning ? colors.warning : colors.border

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
        <Text style={[styles.calloutTitle, { color: colors.ink }]}>{callout.title}</Text>
      </View>
      {children.length > 0 && (
        <View style={styles.calloutBodyContainer}>
          {children.map(child => renderBlock(child, styles, colors, onLinkPress))}
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

function renderBlock(node: MarkdownNode, styles: MarkdownStyles, colors: ThemeColors, onLinkPress?: MarkdownLinkHandler): ReactNode {
  const { token, key, children } = node
  if (token.type === 'math_block') return <MathFormula key={key} source={token.content} display />
  if (token.type === 'paragraph_open') {
    return <Text key={key} selectable style={styles.paragraph}>{renderInlineChildren(children, styles, colors, onLinkPress)}</Text>
  }
  if (token.type === 'heading_open') {
    return <Text key={key} selectable style={[styles.heading, headingStyle(token.tag, styles)]}>{renderInlineChildren(children, styles, colors, onLinkPress)}</Text>
  }
  if (token.type === 'fence' || token.type === 'code_block') {
    const lang = token.type === 'fence' ? token.info.trim().split(/\s+/u)[0] : undefined
    return <CodeBlockView key={key} code={token.content} language={lang} />
  }
  if (token.type === 'blockquote_open') {
    const callout = parseCalloutNode(node)
    if (callout) {
      return (
        <CalloutCard
          key={key}
          callout={callout}
          children={callout.children}
          styles={styles}
          colors={colors}
          onLinkPress={onLinkPress}
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
        {children.map(child => renderBlock(child, styles, colors, onLinkPress))}
      </View>
    )
  }
  if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
    const ordered = token.type === 'ordered_list_open'
    const start = Number(token.attrGet('start') ?? '1')
    return (
      <View key={key} style={styles.list}>
        {children.map((child, index) => renderListItem(child, styles, colors, ordered ? start + index : undefined, onLinkPress))}
      </View>
    )
  }
  if (token.type === 'hr') return <View key={key} style={styles.rule} />
  if (token.type === 'table_open') {
    return (
      <ScrollView
        key={key}
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tableScrollContent}
        style={styles.tableContainer}
      >
        <View style={styles.table}>
          {children.map(child => renderBlock(child, styles, colors, onLinkPress))}
        </View>
      </ScrollView>
    )
  }
  if (token.type === 'thead_open' || token.type === 'tbody_open') return <View key={key}>{children.map(child => renderBlock(child, styles, colors, onLinkPress))}</View>
  if (token.type === 'tr_open') return <View key={key} style={styles.tableRow}>{children.map(child => renderBlock(child, styles, colors, onLinkPress))}</View>
  if (token.type === 'th_open' || token.type === 'td_open') {
    return (
      <View key={key} style={[styles.tableCell, token.type === 'th_open' && styles.tableHeader]}>
        <Text selectable style={token.type === 'th_open' ? styles.tableHeaderText : styles.tableText}>{renderInlineChildren(children, styles, colors, onLinkPress)}</Text>
      </View>
    )
  }
  if (token.type === 'inline') return <Text key={key} selectable style={styles.paragraph}>{renderInline(token.children ?? [], styles, `block:${key}`, onLinkPress)}</Text>
  if (children.length > 0) return <View key={key}>{children.map(child => renderBlock(child, styles, colors, onLinkPress))}</View>
  if (token.content.length > 0) return <Text key={key} selectable style={styles.paragraph}>{token.content}</Text>
  return null
}

function renderListItem(node: MarkdownNode, styles: MarkdownStyles, colors: ThemeColors, number?: number, onLinkPress?: MarkdownLinkHandler): ReactNode {
  if (node.token.type !== 'list_item_open') return renderBlock(node, styles, colors, onLinkPress)
  const task = getTaskInfo(node)
  return (
    <View key={node.key} style={styles.listItem}>
      {task.isTask ? (
        task.checked ? (
          <View
            accessibilityRole="checkbox"
            accessibilityState={{ checked: true, disabled: true }}
            accessibilityLabel="已完成"
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
            accessibilityLabel="未完成"
            style={[styles.checkboxUnchecked, { borderColor: colors.subtle }]}
          />
        )
      ) : (
        <Text style={styles.listMarker}>{number === undefined ? '•' : `${number}.`}</Text>
      )}
      <View style={styles.listContent}>{task.children.map(child => renderBlock(child, styles, colors, onLinkPress))}</View>
    </View>
  )
}

function renderInlineChildren(nodes: MarkdownNode[], styles: MarkdownStyles, colors: ThemeColors, onLinkPress?: MarkdownLinkHandler): ReactNode[] {
  return nodes.flatMap(node => node.token.type === 'inline'
    ? renderInline(node.token.children ?? [], styles, `inline:${node.key}`, onLinkPress)
    : [renderBlock(node, styles, colors, onLinkPress)])
}

function renderInline(tokens: Token[], styles: MarkdownStyles, prefix: string, onLinkPress?: MarkdownLinkHandler): ReactNode[] {
  const output: ReactNode[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    const key = `${prefix}:${index}`
    if (token.type === 'math_inline') output.push(<MathFormula key={key} source={token.content} />)
    else if (token.type === 'text') output.push(token.content)
    else if (token.type === 'softbreak' || token.type === 'hardbreak') output.push('\n')
    else if (token.type === 'code_inline') {
      const isMention = token.content.startsWith('/') || token.content.startsWith('@')
      output.push(<Text key={key} style={[styles.inlineCode, isMention && styles.mentionCode]}>{token.content}</Text>)
    }
    else if (token.type === 'image') {
      const alt = token.content || token.children?.map(child => child.content).join('') || '图片'
      const src = token.attrGet('src') ?? ''
      output.push(src.startsWith('data:') || chatImageWorkspacePath(src) !== undefined
        ? <ChatImageView key={key} image={{ uri: src, name: alt }} remoteSource />
        : <Text key={key} style={styles.imageAlt}>{`[${alt}]`}</Text>)
    } else if (token.nesting === 1) {
      const closing = findClosingToken(tokens, index)
      if (closing < 0) continue
      const content = renderInline(tokens.slice(index + 1, closing), styles, key, onLinkPress)
      if (token.type === 'strong_open') output.push(<Text key={key} style={styles.strong}>{content}</Text>)
      else if (token.type === 'em_open') output.push(<Text key={key} style={styles.emphasis}>{content}</Text>)
      else if (token.type === 's_open') output.push(<Text key={key} style={styles.strike}>{content}</Text>)
      else if (token.type === 'link_open') {
        const href = token.attrGet('href') ?? ''
        const rawText = tokens.slice(index + 1, closing).map(t => t.content).join('')
        const linkInfo = classifyMarkdownLink(href, rawText)
        const filePath = linkInfo.kind === 'workspace' ? (linkInfo.workspacePath ?? markdownFilePath(href)) : undefined
        const linkKind = filePath ? classifyDshLinkPath(filePath) : undefined
        const handlePress = !linkInfo.isBlocked && linkInfo.safeHref !== null
          ? () => {
              if (onLinkPress !== undefined) {
                onLinkPress(linkInfo.safeHref!)
              } else {
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
              {content}
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
                {linkInfo.citationIndex ? `[${linkInfo.citationIndex}]` : content}
              </Text>
            </Text>
          )
        } else if (linkInfo.kind === 'external') {
          output.push(
            <Text
              key={key}
              style={styles.linkExternal}
              accessibilityRole="link"
              accessibilityLabel={`${rawText || linkInfo.displayText}, 外部链接${linkInfo.domain ? ` (${linkInfo.domain})` : ''}`}
              onPress={handlePress}
            >
              {linkInfo.displayText !== rawText && linkInfo.displayText.length > 0 ? linkInfo.displayText : content}
              <Text style={styles.linkExternalIcon}> ↗</Text>
            </Text>
          )
        } else {
          output.push(
            <Text key={key} style={styles.link} accessibilityRole="link" onPress={handlePress}>
              {linkKind && (
                <View style={{ marginRight: 3, top: 1 }}>
                  <DshLinkIcon kind={linkKind} size={14} color={styles.link.color} />
                </View>
              )}
              {linkKind ? ' ' : ''}
              {content}
            </Text>
          )
        }
      }
      else output.push(...content)
      index = closing
    } else if (token.content.length > 0) output.push(token.content)
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
