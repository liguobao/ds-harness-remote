import { useMemo, type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import MarkdownIt, { type Token } from 'markdown-it'
import { radius, spacing, type } from './theme'
import { type ThemeColors } from './theme-context'
import { useThemedStyles } from './use-themed-styles'

// Remote messages are untrusted E2EE business content. Parse Markdown without
// HTML/linkification and render only native Text/View nodes: no WebView,
// external navigation, or remote image requests.
const parser = new MarkdownIt({ html: false, linkify: false, breaks: true })

interface MarkdownNode {
  key: number
  token: Token
  children: MarkdownNode[]
}

export function NativeMarkdown({ text }: { text: string }) {
  const styles = useThemedStyles(createStyles)
  const nodes = useMemo(() => markdownTree(parser.parse(text, {})), [text])
  return <View style={styles.container}>{nodes.map(node => renderBlock(node, styles))}</View>
}

function markdownTree(tokens: Token[]): MarkdownNode[] {
  if (tokens.length === 0) return []
  const root: MarkdownNode = { key: -1, token: tokens[0]!, children: [] }
  const stack = [root]
  tokens.forEach((token, key) => {
    if (token.nesting === -1) {
      if (stack.length > 1) stack.pop()
      return
    }
    const node = { key, token, children: [] } satisfies MarkdownNode
    stack.at(-1)!.children.push(node)
    if (token.nesting === 1) stack.push(node)
  })
  return root.children
}

type MarkdownStyles = ReturnType<typeof createStyles>

function renderBlock(node: MarkdownNode, styles: MarkdownStyles): ReactNode {
  const { token, key, children } = node
  if (token.type === 'paragraph_open') {
    return <Text key={key} selectable style={styles.paragraph}>{renderInlineChildren(children, styles)}</Text>
  }
  if (token.type === 'heading_open') {
    return <Text key={key} selectable style={[styles.heading, headingStyle(token.tag, styles)]}>{renderInlineChildren(children, styles)}</Text>
  }
  if (token.type === 'fence' || token.type === 'code_block') {
    return <View key={key} style={styles.codeBlock}><Text selectable style={styles.code}>{token.content.replace(/\n$/, '')}</Text></View>
  }
  if (token.type === 'blockquote_open') {
    return <View key={key} style={styles.blockquote}>{children.map(child => renderBlock(child, styles))}</View>
  }
  if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
    const ordered = token.type === 'ordered_list_open'
    const start = Number(token.attrGet('start') ?? '1')
    return (
      <View key={key} style={styles.list}>
        {children.map((child, index) => renderListItem(child, styles, ordered ? start + index : undefined))}
      </View>
    )
  }
  if (token.type === 'hr') return <View key={key} style={styles.rule} />
  if (token.type === 'table_open') return <View key={key} style={styles.table}>{children.map(child => renderBlock(child, styles))}</View>
  if (token.type === 'thead_open' || token.type === 'tbody_open') return <View key={key}>{children.map(child => renderBlock(child, styles))}</View>
  if (token.type === 'tr_open') return <View key={key} style={styles.tableRow}>{children.map(child => renderBlock(child, styles))}</View>
  if (token.type === 'th_open' || token.type === 'td_open') {
    return (
      <View key={key} style={[styles.tableCell, token.type === 'th_open' && styles.tableHeader]}>
        <Text selectable style={token.type === 'th_open' ? styles.tableHeaderText : styles.tableText}>{renderInlineChildren(children, styles)}</Text>
      </View>
    )
  }
  if (token.type === 'inline') return <Text key={key} selectable style={styles.paragraph}>{renderInline(token.children ?? [], styles, `block:${key}`)}</Text>
  if (children.length > 0) return <View key={key}>{children.map(child => renderBlock(child, styles))}</View>
  if (token.content.length > 0) return <Text key={key} selectable style={styles.paragraph}>{token.content}</Text>
  return null
}

function renderListItem(node: MarkdownNode, styles: MarkdownStyles, number?: number): ReactNode {
  if (node.token.type !== 'list_item_open') return renderBlock(node, styles)
  return (
    <View key={node.key} style={styles.listItem}>
      <Text style={styles.listMarker}>{number === undefined ? '•' : `${number}.`}</Text>
      <View style={styles.listContent}>{node.children.map(child => renderBlock(child, styles))}</View>
    </View>
  )
}

function renderInlineChildren(nodes: MarkdownNode[], styles: MarkdownStyles): ReactNode[] {
  return nodes.flatMap(node => node.token.type === 'inline'
    ? renderInline(node.token.children ?? [], styles, `inline:${node.key}`)
    : [renderBlock(node, styles)])
}

function renderInline(tokens: Token[], styles: MarkdownStyles, prefix: string): ReactNode[] {
  const output: ReactNode[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    const key = `${prefix}:${index}`
    if (token.type === 'text') output.push(token.content)
    else if (token.type === 'softbreak' || token.type === 'hardbreak') output.push('\n')
    else if (token.type === 'code_inline') {
      const isMention = token.content.startsWith('/') || token.content.startsWith('@')
      output.push(<Text key={key} style={[styles.inlineCode, isMention && styles.mentionCode]}>{token.content}</Text>)
    }
    else if (token.type === 'image') {
      const alt = token.content || token.children?.map(child => child.content).join('') || '图片'
      output.push(<Text key={key} style={styles.imageAlt}>{`[${alt}]`}</Text>)
    } else if (token.nesting === 1) {
      const closing = findClosingToken(tokens, index)
      if (closing < 0) continue
      const content = renderInline(tokens.slice(index + 1, closing), styles, key)
      if (token.type === 'strong_open') output.push(<Text key={key} style={styles.strong}>{content}</Text>)
      else if (token.type === 'em_open') output.push(<Text key={key} style={styles.emphasis}>{content}</Text>)
      else if (token.type === 's_open') output.push(<Text key={key} style={styles.strike}>{content}</Text>)
      else if (token.type === 'link_open') output.push(<Text key={key} style={styles.link}>{content}</Text>)
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

function headingStyle(tag: string, styles: MarkdownStyles) {
  if (tag === 'h1') return styles.h1
  if (tag === 'h2') return styles.h2
  if (tag === 'h3') return styles.h3
  return styles.h4
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { alignSelf: 'stretch' },
    paragraph: { ...type.body, color: colors.ink, marginBottom: spacing.xs },
    heading: { color: colors.ink, fontWeight: '700', marginTop: spacing.xs, marginBottom: spacing.sm },
    h1: { fontSize: 24, lineHeight: 30 },
    h2: { fontSize: 21, lineHeight: 28 },
    h3: { fontSize: 18, lineHeight: 25 },
    h4: { fontSize: 16, lineHeight: 23 },
    strong: { fontWeight: '700' },
    emphasis: { fontStyle: 'italic' },
    strike: { textDecorationLine: 'line-through' },
    link: { color: colors.primary, textDecorationLine: 'underline' },
    inlineCode: { fontFamily: 'monospace', fontSize: 14, color: colors.ink, backgroundColor: colors.surfaceStrong },
    mentionCode: { color: colors.primary, backgroundColor: colors.primarySoft, borderRadius: 4, paddingHorizontal: 4 },
    imageAlt: { color: colors.muted, fontStyle: 'italic' },
    codeBlock: { alignSelf: 'stretch', borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.sm, marginBottom: spacing.sm },
    code: { fontFamily: 'monospace', fontSize: 13, lineHeight: 20, color: colors.ink },
    blockquote: { borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: spacing.sm, marginBottom: spacing.sm },
    list: { gap: spacing.xxs, marginBottom: spacing.sm },
    listItem: { flexDirection: 'row', alignItems: 'flex-start' },
    listMarker: { ...type.body, color: colors.muted, width: 26 },
    listContent: { flex: 1 },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginVertical: spacing.md },
    table: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.sm, overflow: 'hidden', marginBottom: spacing.sm },
    tableRow: { flexDirection: 'row' },
    tableCell: { flex: 1, padding: spacing.xs, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    tableHeader: { backgroundColor: colors.surfaceStrong },
    tableHeaderText: { ...type.smallStrong, color: colors.ink },
    tableText: { ...type.small, color: colors.ink },
  })
}
