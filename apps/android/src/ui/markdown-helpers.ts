import { StyleSheet } from 'react-native'
import { radius, spacing, typeForDensity } from './theme'
import type { ThemeColors, TypographyDensity } from './theme'
import type { Token } from 'markdown-it'

export interface MarkdownNode {
  key: number
  token: Token
  children: MarkdownNode[]
}

export interface TaskItemInfo {
  isTask: boolean
  checked: boolean
  children: MarkdownNode[]
}

function cloneToken(token: Token, patchProps: Partial<Token>): Token {
  return Object.assign(Object.create(Object.getPrototypeOf(token)), token, patchProps)
}

/**
 * Pure, non-mutating task list detector adhering strictly to GFM task list specification.
 * Inspects ONLY the very first text token of the first inline child.
 * Clones nodes/tokens if task prefix is stripped so the original parse tree is 100% immutable.
 */
export function getTaskInfo(node: MarkdownNode): TaskItemInfo {
  if (node.token.type !== 'list_item_open' || node.children.length === 0) {
    return { isTask: false, checked: false, children: node.children }
  }
  const firstChild = node.children[0]
  if (!firstChild) return { isTask: false, checked: false, children: node.children }

  let targetInline: MarkdownNode | null = null
  if (firstChild.token.type === 'paragraph_open' && firstChild.children.length > 0) {
    targetInline = firstChild.children[0] ?? null
  } else if (firstChild.token.type === 'inline') {
    targetInline = firstChild
  }
  if (!targetInline || targetInline.token.type !== 'inline' || !targetInline.token.children?.length) {
    return { isTask: false, checked: false, children: node.children }
  }
  const firstText = targetInline.token.children[0]
  if (!firstText || firstText.type !== 'text') {
    return { isTask: false, checked: false, children: node.children }
  }

  // Must match [ ] or [x]/[X] followed strictly by whitespace or line end
  const m = firstText.content.match(/^\[([ xX])\](\s+|$)/)
  if (!m) {
    return { isTask: false, checked: false, children: node.children }
  }

  // If there is no whitespace within the first text token and there are subsequent tokens,
  // ensure the next token is a line break (softbreak/hardbreak) rather than unspaced inline formatting
  // such as - [x]**suffix** or - [ ]`code`.
  if (m[2] === '' && targetInline.token.children.length > 1) {
    const nextToken = targetInline.token.children[1]
    if (nextToken && nextToken.type !== 'softbreak' && nextToken.type !== 'hardbreak') {
      return { isTask: false, checked: false, children: node.children }
    }
  }

  const checked = (m[1] ?? '').toLowerCase() === 'x'
  const prefixLen = m[0].length

  // Immutably clone without mutating original token content!
  const clonedFirstText = cloneToken(firstText, { content: firstText.content.slice(prefixLen) })
  const clonedInlineToken = cloneToken(targetInline.token, {
    children: [clonedFirstText, ...targetInline.token.children.slice(1)],
  })
  const clonedInlineNode: MarkdownNode = { ...targetInline, token: clonedInlineToken }

  let newChildren: MarkdownNode[]
  if (firstChild.token.type === 'paragraph_open') {
    const clonedP: MarkdownNode = { ...firstChild, children: [clonedInlineNode, ...firstChild.children.slice(1)] }
    newChildren = [clonedP, ...node.children.slice(1)]
  } else {
    newChildren = [clonedInlineNode, ...node.children.slice(1)]
  }

  return { isTask: true, checked, children: newChildren }
}

export function detectAndStripTask(node: MarkdownNode): { isTask: boolean; checked: boolean } {
  const info = getTaskInfo(node)
  return { isTask: info.isTask, checked: info.checked }
}

export interface CalloutInfo {
  isCallout: boolean
  type: 'NOTE' | 'TIP' | 'WARNING' | 'INFO' | 'IMPORTANT' | 'CAUTION'
  title: string
  body: string
}

export interface CalloutNodeInfo {
  isCallout: boolean
  type: CalloutInfo['type']
  title: string
  children: MarkdownNode[]
}

const CALLOUT_TITLES: Record<string, string> = {
  NOTE: '说明',
  TIP: '提示',
  INFO: '信息',
  IMPORTANT: '重要',
  WARNING: '警告',
  CAUTION: '注意',
}

export function parseCallout(text: string): CalloutInfo | null {
  const match = text.match(/^\[!(NOTE|TIP|WARNING|INFO|IMPORTANT|CAUTION)\][^\S\r\n]*(?:([^\r\n]+))?(?:\r?\n([\s\S]*))?$/i)
  if (!match) return null
  const type = (match[1] ?? 'NOTE').toUpperCase() as CalloutInfo['type']
  const customTitle = match[2]?.trim()
  const title = customTitle || CALLOUT_TITLES[type] || type
  const body = match[3]?.trim() ?? ''
  return { isCallout: true, type, title, body }
}

/**
 * Parses blockquote node into a Callout representation while preserving
 * rich markdown children (bold, links, code, lists) and leaving original tokens immutable.
 * Entire declaration line and its trailing line break are cleanly consumed.
 */
export function parseCalloutNode(node: MarkdownNode): CalloutNodeInfo | null {
  if (node.token.type !== 'blockquote_open' || node.children.length === 0) return null
  const firstP = node.children[0]
  if (!firstP || firstP.token.type !== 'paragraph_open' || firstP.children.length === 0) return null
  const inline = firstP.children[0]
  if (!inline || inline.token.type !== 'inline' || !inline.token.children?.length) return null

  // The declaration MUST begin with a plain text token starting with [! (never inline code `[!NOTE]`)
  const firstToken = inline.token.children[0]
  if (!firstToken || firstToken.type !== 'text' || !firstToken.content.startsWith('[!')) {
    return null
  }

  // Declaration line ends at the first softbreak or hardbreak
  const breakIndex = inline.token.children.findIndex((t: Token) => t.type === 'softbreak' || t.type === 'hardbreak')
  const headerTokens = breakIndex >= 0 ? inline.token.children.slice(0, breakIndex) : inline.token.children

  const match = firstToken.content.match(/^\[!(NOTE|TIP|WARNING|INFO|IMPORTANT|CAUTION)\][^\S\r\n]*(.*)$/i)
  if (!match) return null

  const type = (match[1] ?? 'NOTE').toUpperCase() as CalloutInfo['type']
  const firstTokenTitlePart = match[2] || ''
  const remainingHeaderTokensText = headerTokens.slice(1).map((t: Token) => t.content).join('')
  const customTitle = (firstTokenTitlePart + remainingHeaderTokensText).trim()
  const title = customTitle || CALLOUT_TITLES[type] || type

  // Body tokens inside the first paragraph (cleanly stripped of declaration line and its trailing break!)
  const bodyTokens = breakIndex >= 0 ? inline.token.children.slice(breakIndex + 1) : []
  let newChildren: MarkdownNode[]
  if (bodyTokens.length > 0) {
    const clonedInlineToken = cloneToken(inline.token, { children: bodyTokens })
    const clonedInlineNode: MarkdownNode = { ...inline, token: clonedInlineToken }
    const clonedP: MarkdownNode = { ...firstP, children: [clonedInlineNode, ...firstP.children.slice(1)] }
    newChildren = [clonedP, ...node.children.slice(1)]
  } else {
    newChildren = node.children.slice(1)
  }

  return { isCallout: true, type, title, children: newChildren }
}

export function headingStyle(tag: string, styles: ReturnType<typeof createMarkdownStyles>) {
  if (tag === 'h1') return styles.h1
  if (tag === 'h2') return styles.h2
  if (tag === 'h3') return styles.h3
  return styles.h4
}

export function createMarkdownStyles(colors: ThemeColors, density: TypographyDensity = 'compact') {
  const isCompact = density === 'compact'
  const t = typeForDensity(density)
  return StyleSheet.create({
    container: { alignSelf: 'stretch' },
    paragraph: { ...t.body, fontSize: isCompact ? 15 : 16, lineHeight: isCompact ? 23 : 25, color: colors.ink, marginBottom: isCompact ? 5 : 7 },
    heading: { color: colors.ink, fontWeight: '700', marginTop: isCompact ? 6 : 8, marginBottom: isCompact ? 6 : 8 },
    h1: isCompact ? { fontSize: 21, lineHeight: 27, includeFontPadding: false } : { fontSize: 24, lineHeight: 31, includeFontPadding: false },
    h2: isCompact ? { fontSize: 18, lineHeight: 23, includeFontPadding: false } : { fontSize: 20, lineHeight: 26, includeFontPadding: false },
    h3: isCompact ? { fontSize: 16, lineHeight: 21, includeFontPadding: false } : { fontSize: 17, lineHeight: 23, includeFontPadding: false },
    h4: isCompact ? { fontSize: 14, lineHeight: 19, includeFontPadding: false } : { fontSize: 15, lineHeight: 20, includeFontPadding: false },
    strong: { fontWeight: '700' },
    emphasis: { fontStyle: 'italic' },
    strike: { textDecorationLine: 'line-through' },
    link: { color: colors.primary, textDecorationLine: 'underline' },
    linkExternal: { color: colors.primary, textDecorationLine: 'underline', fontWeight: '500' },
    linkExternalIcon: { fontSize: 11, color: colors.primary, fontWeight: '600' },
    citationBadge: { backgroundColor: colors.surfaceStrong, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, marginHorizontal: 2 },
    citationText: { fontSize: 11, fontWeight: '600', color: colors.primary },
    blockedLink: { color: colors.muted, textDecorationLine: 'line-through' },
    inlineCode: { fontFamily: 'monospace', fontSize: isCompact ? 12.5 : 13.5, color: colors.ink, backgroundColor: colors.surfaceStrong, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, includeFontPadding: false },
    mentionCode: { color: colors.primary, backgroundColor: colors.primarySoft, borderRadius: 4, paddingHorizontal: 4 },
    imageAlt: { color: colors.muted, fontStyle: 'italic' },
    codeBlock: { alignSelf: 'stretch', borderRadius: radius.md, backgroundColor: colors.surface, padding: isCompact ? 8 : 10, marginBottom: isCompact ? 5 : 8 },
    code: { fontFamily: 'monospace', fontSize: isCompact ? 12 : 13, lineHeight: isCompact ? 17 : 18.5, color: colors.ink, includeFontPadding: false },
    blockquote: { borderLeftWidth: 3, borderLeftColor: colors.primary, backgroundColor: colors.surfaceStrong, paddingLeft: isCompact ? 10 : 12, paddingRight: isCompact ? 8 : 10, paddingVertical: isCompact ? 6 : 8, borderRadius: 6, marginBottom: isCompact ? 6 : 8 },
    blockquotePreview: { backgroundColor: colors.surfaceStrong, borderColor: 'transparent', borderLeftWidth: 3, borderLeftColor: colors.primary, borderRadius: 6, marginVertical: isCompact ? 4 : 6 },
    calloutCard: { borderRadius: radius.md, borderWidth: 1, padding: isCompact ? 10 : 12, marginVertical: isCompact ? 6 : 8, alignSelf: 'stretch' },
    calloutHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    calloutIconWrap: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    calloutTitle: { ...t.smallStrong, fontWeight: '600' },
    calloutBody: { ...t.body, fontSize: isCompact ? 14 : 15, lineHeight: isCompact ? 20 : 22 },
    calloutBodyContainer: { marginTop: 4 },
    list: { gap: isCompact ? 2 : 3, marginBottom: isCompact ? 6 : 8 },
    listItem: { flexDirection: 'row', alignItems: 'flex-start' },
    listMarker: { ...t.body, color: colors.muted, width: isCompact ? 22 : 26 },
    listContent: { flex: 1 },
    checkboxChecked: { width: 16, height: 16, borderRadius: 4, alignItems: 'center', justifyContent: 'center' as const, marginRight: isCompact ? 6 : 8, marginTop: isCompact ? 3 : 4 },
    checkboxUnchecked: { width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, marginRight: isCompact ? 6 : 8, marginTop: isCompact ? 3 : 4 },
    rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginVertical: isCompact ? spacing.sm : spacing.md },
    tableContainer: { alignSelf: 'stretch', marginVertical: isCompact ? 6 : 8 },
    tableScrollContent: { minWidth: '100%' },
    table: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.sm, overflow: 'hidden', minWidth: '100%' },
    tableRow: { flexDirection: 'row', minWidth: '100%' },
    tableCell: { flex: 1, minWidth: isCompact ? 80 : 96, paddingHorizontal: isCompact ? 8 : 12, paddingVertical: isCompact ? 6 : 8, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border, justifyContent: 'center' },
    tableHeader: { backgroundColor: colors.surfaceStrong },
    tableHeaderText: { ...t.smallStrong, fontWeight: '600', color: colors.ink },
    tableText: { ...t.small, color: colors.ink },
  })
}
