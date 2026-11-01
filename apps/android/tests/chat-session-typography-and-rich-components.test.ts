import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  StyleSheet: {
    create: (styles: any) => styles,
    hairlineWidth: 1,
  },
}))

import { lightColors, darkColors } from '../src/ui/theme'
import {
  createMarkdownStyles as createStyles,
  parseCallout,
  parseCalloutNode,
  getTaskInfo,
  detectAndStripTask,
} from '../src/ui/markdown-helpers'
import type { MarkdownNode } from '../src/ui/markdown-helpers'
import MarkdownIt from 'markdown-it'

describe('chat session typography and rich components', () => {
  describe('typography hierarchy and line height ratios', () => {
    it('standard density headings and body adhere to balanced reading proportions', () => {
      const styles = createStyles(lightColors, 'standard')

      // H1-H4 size ladder
      expect(styles.h1.fontSize).toBe(24)
      expect(styles.h1.lineHeight).toBe(31)
      expect(styles.h2.fontSize).toBe(20)
      expect(styles.h2.lineHeight).toBe(26)
      expect(styles.h3.fontSize).toBe(17)
      expect(styles.h3.lineHeight).toBe(23)
      expect(styles.h4.fontSize).toBe(15)
      expect(styles.h4.lineHeight).toBe(20)

      // Paragraph line-height ratio >= 1.5 for comfortable continuous reading
      expect(styles.paragraph.fontSize).toBe(16)
      expect(styles.paragraph.lineHeight).toBe(25)
      const ratio = (styles.paragraph.lineHeight as number) / (styles.paragraph.fontSize as number)
      expect(ratio).toBeGreaterThanOrEqual(1.5)
      expect(ratio).toBeLessThanOrEqual(1.65)
    })

    it('compact density provides proportional scaling for small displays', () => {
      const styles = createStyles(lightColors, 'compact')

      expect(styles.h1.fontSize).toBe(21)
      expect(styles.h1.lineHeight).toBe(27)
      expect(styles.h2.fontSize).toBe(18)
      expect(styles.h2.lineHeight).toBe(23)
      expect(styles.h3.fontSize).toBe(16)
      expect(styles.h3.lineHeight).toBe(21)
      expect(styles.h4.fontSize).toBe(14)
      expect(styles.h4.lineHeight).toBe(19)

      expect(styles.paragraph.fontSize).toBe(15)
      expect(styles.paragraph.lineHeight).toBe(23)
      const ratio = (styles.paragraph.lineHeight as number) / (styles.paragraph.fontSize as number)
      expect(ratio).toBeGreaterThanOrEqual(1.5)
      expect(ratio).toBeLessThanOrEqual(1.65)
    })

    it('inline code has padded pill background with rounded corners', () => {
      const styles = createStyles(lightColors, 'standard')
      expect(styles.inlineCode.borderRadius).toBe(4)
      expect(styles.inlineCode.paddingHorizontal).toBe(5)
      expect(styles.inlineCode.fontFamily).toBe('monospace')
    })
  })

  describe('table horizontal scroll container and column alignment', () => {
    it('table has horizontal scroll container and non-crushing cell bounds', () => {
      const stdStyles = createStyles(lightColors, 'standard')
      const compactStyles = createStyles(lightColors, 'compact')

      // Scroll container properties
      expect(stdStyles.tableContainer.alignSelf).toBe('stretch')
      expect(stdStyles.tableScrollContent.minWidth).toBe('100%')

      // Standard cell min-width and padding
      expect(stdStyles.tableCell.flex).toBe(1)
      expect(stdStyles.tableCell.minWidth).toBe(96)
      expect(stdStyles.tableCell.paddingHorizontal).toBe(12)
      expect(stdStyles.tableCell.paddingVertical).toBe(8)
      expect(stdStyles.tableHeader.backgroundColor).toBe(lightColors.surfaceStrong)

      // Compact cell min-width and padding
      expect(compactStyles.tableCell.flex).toBe(1)
      expect(compactStyles.tableCell.minWidth).toBe(80)
      expect(compactStyles.tableCell.paddingHorizontal).toBe(8)
      expect(compactStyles.tableCell.paddingVertical).toBe(6)
    })

    it('table row spans full width so all cells in each row align vertically across columns', () => {
      const stdStyles = createStyles(lightColors, 'standard')
      expect(stdStyles.table.minWidth).toBe('100%')
      expect(stdStyles.tableRow.minWidth).toBe('100%')
      expect(stdStyles.tableRow.flexDirection).toBe('row')
    })

    it('dark theme table correctly uses theme-specific surface and borders', () => {
      const darkStyles = createStyles(darkColors, 'standard')
      expect(darkStyles.tableHeader.backgroundColor).toBe(darkColors.surfaceStrong)
      expect(darkStyles.tableCell.borderColor).toBe(darkColors.border)
    })
  })

  describe('task list detection and immutability', () => {
    function buildNodeTree(markdown: string): MarkdownNode[] {
      const parser = new MarkdownIt({ html: false, breaks: true })
      const tokens = parser.parse(markdown, {})
      const root: MarkdownNode = { key: -1, token: tokens[0]!, children: [] }
      const stack = [root]
      tokens.forEach((token: any, key: number) => {
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

    it('identifies unchecked task item and strips prefix without mutating original token', () => {
      const tree = buildNodeTree('- [ ] Complete documentation review')
      const bulletList = tree[0]!
      const listItem = bulletList.children[0]!

      // First run
      const task1 = getTaskInfo(listItem)
      expect(task1.isTask).toBe(true)
      expect(task1.checked).toBe(false)

      // Check stripped content in cloned tree
      const p1 = task1.children[0]!
      const inline1 = p1.children[0]!
      expect(inline1.token.children![0]!.content).toBe('Complete documentation review')

      // Check original tree remains completely untouched
      const origP = listItem.children[0]!
      const origInline = origP.children[0]!
      expect(origInline.token.children![0]!.content).toBe('[ ] Complete documentation review')

      // Second run (simulating re-render / theme switch / memo lookup)
      const task2 = getTaskInfo(listItem)
      expect(task2.isTask).toBe(true)
      expect(task2.checked).toBe(false)
      expect(origInline.token.children![0]!.content).toBe('[ ] Complete documentation review')
    })

    it('identifies checked task item with lowercase x and uppercase X and preserves immutability', () => {
      const treeLower = buildNodeTree('- [x] Run automated regression tests')
      const listItemLower = treeLower[0]!.children[0]!
      const taskLower = getTaskInfo(listItemLower)
      expect(taskLower.isTask).toBe(true)
      expect(taskLower.checked).toBe(true)
      expect(listItemLower.children[0]!.children[0]!.token.children![0]!.content).toBe('[x] Run automated regression tests')

      const treeUpper = buildNodeTree('- [X] Deploy release to staging')
      const listItemUpper = treeUpper[0]!.children[0]!
      const taskUpper = getTaskInfo(listItemUpper)
      expect(taskUpper.isTask).toBe(true)
      expect(taskUpper.checked).toBe(true)
      expect(listItemUpper.children[0]!.children[0]!.token.children![0]!.content).toBe('[X] Deploy release to staging')
    })

    it('rejects invalid task markers without space suffix and connected inline tokens', () => {
      const tree = buildNodeTree('- [x]suffix invalid task\n- [ ]nosuffix\n- [x]**bold**\n- [ ]`code`')
      const item1 = tree[0]!.children[0]!
      const item2 = tree[0]!.children[1]!
      const item3 = tree[0]!.children[2]!
      const item4 = tree[0]!.children[3]!
      expect(getTaskInfo(item1).isTask).toBe(false)
      expect(getTaskInfo(item2).isTask).toBe(false)
      expect(getTaskInfo(item3).isTask).toBe(false)
      expect(getTaskInfo(item4).isTask).toBe(false)
    })

    it('accepts task item whose text begins on next line after line break', () => {
      const tree = buildNodeTree('- [x]\n  Task on next line')
      const item = tree[0]!.children[0]!
      const task = getTaskInfo(item)
      expect(task.isTask).toBe(true)
      expect(task.checked).toBe(true)
      const p = task.children[0]!
      const inlineTokens = p.children[0]!.token.children!
      // Must not have [x] in the rendered text
      expect(inlineTokens.some(t => t.content.includes('[x]'))).toBe(false)
    })

    it('leaves standard bullet items and numbered lists untouched', () => {
      const tree = buildNodeTree('- Standard unordered item\n1. Standard ordered item')
      const bulletItem = tree[0]!.children[0]!
      const taskBullet = detectAndStripTask(bulletItem)
      expect(taskBullet.isTask).toBe(false)
      expect(taskBullet.checked).toBe(false)

      const orderedItem = tree[1]!.children[0]!
      const taskOrdered = detectAndStripTask(orderedItem)
      expect(taskOrdered.isTask).toBe(false)
      expect(taskOrdered.checked).toBe(false)
    })

    it('checkbox styles have proper size and alignments', () => {
      const styles = createStyles(lightColors, 'standard')
      expect(styles.checkboxChecked.width).toBe(16)
      expect(styles.checkboxChecked.height).toBe(16)
      expect(styles.checkboxChecked.borderRadius).toBe(4)

      expect(styles.checkboxUnchecked.width).toBe(16)
      expect(styles.checkboxUnchecked.height).toBe(16)
      expect(styles.checkboxUnchecked.borderWidth).toBe(1.5)
    })
  })

  describe('callout alert cards and blockquotes', () => {
    function buildNodeTree(markdown: string): MarkdownNode[] {
      const parser = new MarkdownIt({ html: false, breaks: true })
      const tokens = parser.parse(markdown, {})
      const root: MarkdownNode = { key: -1, token: tokens[0]!, children: [] }
      const stack = [root]
      tokens.forEach((token: any, key: number) => {
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

    it('parses GitHub-style callouts with default localized titles', () => {
      const note = parseCallout('[!NOTE]\nThis is an informative note for the user.')
      expect(note).not.toBeNull()
      expect(note?.type).toBe('NOTE')
      expect(note?.title).toBe('说明')
      expect(note?.body).toBe('This is an informative note for the user.')

      const tip = parseCallout('[!TIP]\nHere is a handy productivity shortcut.')
      expect(tip?.type).toBe('TIP')
      expect(tip?.title).toBe('提示')
      expect(tip?.body).toBe('Here is a handy productivity shortcut.')

      const warning = parseCallout('[!WARNING]\nAction cannot be undone.')
      expect(warning?.type).toBe('WARNING')
      expect(warning?.title).toBe('警告')
      expect(warning?.body).toBe('Action cannot be undone.')

      const important = parseCallout('[!IMPORTANT]\nCritical update required.')
      expect(important?.type).toBe('IMPORTANT')
      expect(important?.title).toBe('重要')
      expect(important?.body).toBe('Critical update required.')

      const caution = parseCallout('[!CAUTION]\nProceed with extreme caution.')
      expect(caution?.type).toBe('CAUTION')
      expect(caution?.title).toBe('注意')
      expect(caution?.body).toBe('Proceed with extreme caution.')

      const info = parseCallout('[!INFO]\nRelease version 0.6.0 is ready.')
      expect(info?.type).toBe('INFO')
      expect(info?.title).toBe('信息')
      expect(info?.body).toBe('Release version 0.6.0 is ready.')
    })

    it('respects custom title specified on the callout declaration line', () => {
      const custom = parseCallout('[!TIP] 实用技巧：快捷指令\n输入 / 可以呼出指令菜单。')
      expect(custom?.type).toBe('TIP')
      expect(custom?.title).toBe('实用技巧：快捷指令')
      expect(custom?.body).toBe('输入 / 可以呼出指令菜单。')
    })

    it('parseCalloutNode preserves rich markdown child nodes and keeps original immutable', () => {
      const md = '> [!NOTE] 详细指引\n> 请查阅 [API 文档](https://example.com) 并确认 **安全规范**。\n>\n> - [x] 已核对'
      const tree = buildNodeTree(md)
      const blockquote = tree[0]!

      const calloutNode = parseCalloutNode(blockquote)
      expect(calloutNode).not.toBeNull()
      expect(calloutNode?.type).toBe('NOTE')
      expect(calloutNode?.title).toBe('详细指引')

      // Preserves child structure: paragraph with link/bold, followed by task list
      expect(calloutNode!.children.length).toBe(2)
      const firstChildP = calloutNode!.children[0]!
      const inlineChildren = firstChildP.children[0]!.token.children!

      // First token in body paragraph MUST be text, NOT a softbreak or hardbreak!
      expect(inlineChildren[0]!.type).toBe('text')
      expect(inlineChildren[0]!.content).toBe('请查阅 ')

      const hasLink = inlineChildren.some((t: any) => t.type === 'link_open')
      const hasStrong = inlineChildren.some((t: any) => t.type === 'strong_open')
      expect(hasLink).toBe(true)
      expect(hasStrong).toBe(true)

      // Original tree first token content is completely untouched!
      const origFirstContent = blockquote.children[0]!.children[0]!.token.children![0]!.content
      expect(origFirstContent.startsWith('[!NOTE] 详细指引')).toBe(true)
    })

    it('parseCalloutNode consumes multiline title and strips declaration line break completely', () => {
      const md = '> [!TIP] 实用技巧：快捷指令\n> 输入 / 可以呼出指令菜单。'
      const tree = buildNodeTree(md)
      const calloutNode = parseCalloutNode(tree[0]!)
      expect(calloutNode).not.toBeNull()
      expect(calloutNode?.type).toBe('TIP')
      expect(calloutNode?.title).toBe('实用技巧：快捷指令')

      // The body tokens must begin directly with text, not a softbreak
      const firstChildP = calloutNode!.children[0]!
      const firstBodyToken = firstChildP.children[0]!.token.children![0]!
      expect(firstBodyToken.type).toBe('text')
      expect(firstBodyToken.content).toBe('输入 / 可以呼出指令菜单。')
    })

    it('returns null for non-callout regular prose quotes', () => {
      expect(parseCallout('This is a simple quoted paragraph from a document.')).toBeNull()
      expect(parseCallout('“这是一句被引用的对话”')).toBeNull()

      const tree = buildNodeTree('> Just an ordinary quotation.')
      expect(parseCalloutNode(tree[0]!)).toBeNull()

      // Inline code quotes like `[!NOTE]` must not be misidentified as callouts
      const treeCode = buildNodeTree('> `[!NOTE]`\n> explaining markdown syntax')
      expect(parseCalloutNode(treeCode[0]!)).toBeNull()
    })

    it('callout card and standard blockquote have balanced container styling', () => {
      const styles = createStyles(lightColors, 'standard')
      expect(styles.calloutCard.borderRadius).toBe(12)
      expect(styles.calloutCard.borderWidth).toBe(1)
      expect(styles.calloutHeader.flexDirection).toBe('row')

      expect(styles.blockquote.borderLeftWidth).toBe(3)
      expect(styles.blockquote.borderRadius).toBe(6)
      expect(styles.blockquote.backgroundColor).toBe(lightColors.surfaceStrong)
    })
  })
})
