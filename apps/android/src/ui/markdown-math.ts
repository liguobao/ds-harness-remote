import type MarkdownIt from 'markdown-it'

/** Recognize math before Markdown consumes backslashes, underscores or stars. */
export function installMath(parser: MarkdownIt): void {
  parser.block.ruler.before('fence', 'math_block', (state, start, end, silent) => {
    if (state.sCount[start]! - state.blkIndent >= 4) return false
    const offset = state.bMarks[start]! + state.tShift[start]!
    const first = state.src.slice(offset, state.eMarks[start]).trim()
    const open = first.startsWith('$$') ? '$$' : first.startsWith('\\[') ? '\\[' : undefined
    if (!open) return false
    const close = open === '$$' ? '$$' : '\\]'
    let line = start
    let content = first.slice(open.length)
    while (!content.trimEnd().endsWith(close)) {
      line += 1
      if (line >= end || (state.sCount[line]! < state.blkIndent && state.src.slice(state.bMarks[line], state.eMarks[line]).trim())) return false
      content += '\n' + state.src.slice(state.bMarks[line]! + state.tShift[line]!, state.eMarks[line])
    }
    content = content.trimEnd().slice(0, -close.length).trim()
    if (!content) return false
    if (silent) return true
    const token = state.push('math_block', 'math', 0)
    token.content = content
    token.map = [start, line + 1]
    state.line = line + 1
    return true
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })

  parser.inline.ruler.before('escape', 'math_inline', (state, silent) => {
    const start = state.pos
    const open = state.src.startsWith('\\(', start) ? '\\(' : state.src[start] === '$' && state.src[start + 1] !== '$' && state.src[start - 1] !== '$' ? '$' : undefined
    if (!open) return false
    const from = start + open.length
    if (open === '$' && /\s/u.test(state.src[from] ?? ' ')) return false
    const close = open === '$' ? '$' : '\\)'
    let end = from
    while ((end = state.src.indexOf(close, end)) >= 0) {
      let slashes = 0
      for (let i = end - 1; i >= from && state.src[i] === '\\'; i -= 1) slashes += 1
      if (slashes % 2 === 0) break
      end += close.length
    }
    if (end <= from || end >= state.posMax || state.src.slice(from, end).includes('\n')) return false
    if (open === '$' && (/\s/u.test(state.src[end - 1]!) || /[\d$]/u.test(state.src[end + 1] ?? ''))) return false
    if (!silent) {
      const token = state.push('math_inline', 'math', 0)
      token.content = state.src.slice(from, end)
      token.markup = open
    }
    state.pos = end + close.length
    return true
  })
}
