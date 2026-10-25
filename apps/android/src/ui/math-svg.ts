import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js'
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js'

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)

export interface MathSvg { xml: string; width: number; height: number }

function replaceMacroWithBraces(input: string, macroRe: RegExp, replacement: string): string {
  let result = ''
  let i = 0
  const globalRe = new RegExp(macroRe.source, 'gu')
  while (i < input.length) {
    globalRe.lastIndex = i
    const match = globalRe.exec(input)
    if (!match) { result += input.slice(i); break }
    // Check if the preceding backslash was escaped (odd count of backslashes before macro means escaped backslash)
    let backslashes = 0
    for (let k = match.index - 1; k >= 0 && input[k] === '\\'; k -= 1) backslashes += 1
    if (backslashes % 2 !== 0) {
      result += input.slice(i, match.index + match[0].length)
      i = match.index + match[0].length
      continue
    }

    if (match.index > i) result += input.slice(i, match.index)
    const afterMacro = match.index + match[0].length
    let j = afterMacro
    while (j < input.length && /\s/u.test(input[j] ?? '')) j += 1
    if (input[j] !== '{') { result += match[0]; i = afterMacro; continue }
    let depth = 0
    let k = j
    let groupEnd = -1
    for (; k < input.length; k += 1) {
      const ch = input[k]
      if (ch === '\\') { k += 1; continue }
      if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) { groupEnd = k; break }
      }
    }
    if (groupEnd === -1) { result += input.slice(match.index); break }
    const inner = input.slice(j + 1, groupEnd)
    result += `${replacement}{${inner}}`
    i = groupEnd + 1
  }
  return result
}

/** Preprocesses TeX macros to MathJax-compatible equivalents. */
export function preprocessTeX(source: string): string {
  if (!source) return source
  let out = source
  const BOLD_RE = /(?:^|[^\\])(?:\\\\)*\\(?:boldsymbol|bm)\s*\{/u
  let guard = 0
  while (BOLD_RE.test(out) && guard < 64) {
    const prev = out
    guard += 1
    out = replaceMacroWithBraces(out, /\\(?:boldsymbol|bm)\s*/u, String.raw`\mathbf`)
    if (out === prev) break
  }
  // Convert single-token macros: \boldsymbol\alpha, \bm\tau, \bm x -> \mathbf{\alpha}, etc.
  out = out.replace(/(^|[^\\])(?:\\\\)*\\(?:boldsymbol|bm)\s+(\\[A-Za-z]+|[A-Za-z])/gu, (_, prefix: string, token: string) => `${prefix}${String.raw`\mathbf`}{${token}}`)
  return out.trim()
}

/** Local TeX → paths only. No HTML, URL, extension loader or shared user macros. */
export function renderMathSvg(source: string, display: boolean): MathSvg | undefined {
  if (source.length > 4096) return undefined
  try {
    const tex = new TeX({ packages: ['base', 'ams'], maxBuffer: 4096, maxMacros: 256 })
    const document = mathjax.document('', { InputJax: tex, OutputJax: new SVG({ fontCache: 'none' }) })
    const node = document.convert(preprocessTeX(source), { display })
    const xml = adaptor.outerHTML(node)
    if (xml.includes('data-mjx-error') || xml.includes('<text')) return undefined
    const svg = xml.slice(xml.indexOf('<svg'), xml.lastIndexOf('</svg>') + 6)
    const viewBox = /viewBox="([^"]+)"/u.exec(svg)?.[1]?.split(/\s+/u).map(Number)
    if (!viewBox || viewBox.length !== 4) return undefined
    // MathJax's path coordinates use 1000 units per em.
    const width = viewBox[2]! / 1000
    const height = viewBox[3]! / 1000
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 200 || height > 100) return undefined
    return { xml: svg, width, height }
  } catch {
    return undefined
  }
}
