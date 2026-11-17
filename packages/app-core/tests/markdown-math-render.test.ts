import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { installMath } from '../src/ui/markdown-math'
import { preprocessTeX, renderMathSvg } from '../src/ui/math-svg'
import { getFileGlyph, markdownFilePath, classifyDshFileType, classifyDshLinkPath, getDshCategoryTheme } from '../src/ui/file-glyph'

describe('markdown math delimiters and TeX preprocessing', () => {
  it('correctly matches TeX delimiters \\( \\) and \\[ \\] alongside $$ and $', () => {
    const parser = new MarkdownIt({ html: false })
    installMath(parser)

    const text = 'Torques \\(\\boldsymbol{\\tau}\\) and \\(\\boldsymbol{\\lambda}\\) with $\\dot{\\mathbf{L}}_c \\neq 0$.\n\n\\[\n\\min_{\\ddot{\\mathbf{q}}} \\frac{1}{2}\n\\]'
    const tokens = parser.parse(text, {})

    const p = tokens.find(t => t.type === 'inline')
    expect(p).toBeDefined()
    const mathInlines = p!.children?.filter(c => c.type === 'math_inline') ?? []
    expect(mathInlines.length).toBe(3)
    expect(mathInlines[0]!.content).toBe('\\boldsymbol{\\tau}')
    expect(mathInlines[0]!.markup).toBe('\\(')
    expect(mathInlines[1]!.content).toBe('\\boldsymbol{\\lambda}')
    expect(mathInlines[1]!.markup).toBe('\\(')
    expect(mathInlines[2]!.content).toBe('\\dot{\\mathbf{L}}_c \\neq 0')
    expect(mathInlines[2]!.markup).toBe('$')

    const mathBlock = tokens.find(t => t.type === 'math_block')
    expect(mathBlock).toBeDefined()
    expect(mathBlock!.content).toContain('\\min_{\\ddot{\\mathbf{q}}}')
  })

  it('preprocesses \\boldsymbol and \\bm to \\mathbf for MathJax compatibility', () => {
    expect(preprocessTeX('\\boldsymbol{\\tau}')).toBe('\\mathbf{\\tau}')
    expect(preprocessTeX('\\boldsymbol{\\lambda}')).toBe('\\mathbf{\\lambda}')
    expect(preprocessTeX('\\bm{x} + \\bm y')).toBe('\\mathbf{x} + \\mathbf{y}')
  })

  it('renders MathJax SVG successfully for formulas with \\boldsymbol without throwing', () => {
    const tau = renderMathSvg('\\boldsymbol{\\tau}', false)
    expect(tau).toBeDefined()
    expect(tau!.xml).toContain('<svg')
    expect(tau!.width).toBeGreaterThan(0)
    expect(tau!.height).toBeGreaterThan(0)

    const lambda = renderMathSvg('\\boldsymbol{\\lambda}', false)
    expect(lambda).toBeDefined()
    expect(lambda!.xml).toContain('<svg')

    const qp = renderMathSvg('\\min_{\\ddot{\\mathbf{q}}, \\mathbf{f}} \\frac{1}{2} \\|\\dot{\\mathbf{v}} - \\dot{\\mathbf{v}}^\\text{des}\\|^2_W', true)
    expect(qp).toBeDefined()
    expect(qp!.xml).toContain('<svg')
  })
})

describe('file glyphs and markdown file links', () => {
  it('correctly classifies image files with official DSH theme and link glyph', () => {
    expect(classifyDshFileType('1000000161.png')).toBe('image')
    expect(classifyDshLinkPath('1000000161.png')).toBe('image')
    const theme = getDshCategoryTheme('image')
    expect(theme.color).toBe('rgb(139, 118, 246)')
  })

  it('correctly classifies code files with official DSH code category', () => {
    expect(classifyDshFileType('src/main.ts')).toBe('code')
    expect(classifyDshLinkPath('src/main.ts')).toBe('code')
    expect(classifyDshFileType('script.py')).toBe('code')
  })

  it('resolves relative workspace markdown file paths while rejecting external URLs', () => {
    expect(markdownFilePath('1000000161.png')).toBe('1000000161.png')
    expect(markdownFilePath('./docs/report.pdf')).toBe('docs/report.pdf')
    expect(markdownFilePath('https://example.com/pic.png')).toBeUndefined()
  })

  it('verifies code fences containing link syntax are not parsed as real link tokens', () => {
    const parser = new MarkdownIt({ html: false })
    const md = 'Here is code:\n```markdown\n[example](./example.ts)\n```\nAnd a real link [real](1000000161.png)'
    const tokens = parser.parse(md, {})
    const fence = tokens.find(t => t.type === 'fence')
    expect(fence).toBeDefined()
    expect(fence!.content).toContain('[example](./example.ts)')

    const inlines = tokens.filter(t => t.type === 'inline').flatMap(t => t.children ?? [])
    const links = inlines.filter(c => c.type === 'link_open')
    expect(links.length).toBe(1)
    expect(links[0]!.attrGet('href')).toBe('1000000161.png')
  })
})
