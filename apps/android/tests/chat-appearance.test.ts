import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHAT_APPEARANCE,
  normalizeChatAppearance,
  resolveChatMetrics,
  resolveThemeColors,
} from '../src/ui/theme'
import { highlightCode } from '../src/ui/syntax-highlight'

describe('chat appearance normalization, metrics and syntax highlighting', () => {
  it('normalizes invalid or partial stored appearance payloads safely', () => {
    expect(normalizeChatAppearance(null)).toEqual(DEFAULT_CHAT_APPEARANCE)
    expect(normalizeChatAppearance([])).toEqual(DEFAULT_CHAT_APPEARANCE)
    expect(normalizeChatAppearance({
      fontScale: 'huge',
      spacingScale: 'relaxed',
      letterSpacing: 'wider',
      accent: 'emerald',
      bubbleStyle: 'solid',
      codeTheme: 'dark',
    })).toEqual({
      fontScale: DEFAULT_CHAT_APPEARANCE.fontScale,
      spacingScale: 'relaxed',
      letterSpacing: 'wider',
      accent: 'emerald',
      bubbleStyle: 'solid',
      codeTheme: 'dark',
    })
  })

  it('derives monotonic typography metrics and safe foreground contrast for all accent palettes', () => {
    const smTight = resolveChatMetrics('compact', { ...DEFAULT_CHAT_APPEARANCE, fontScale: 'sm', spacingScale: 'tight', letterSpacing: 'normal' })
    const xlRelaxed = resolveChatMetrics('standard', { ...DEFAULT_CHAT_APPEARANCE, fontScale: 'xl', spacingScale: 'relaxed', letterSpacing: 'wider' })

    expect(xlRelaxed.bodyFontSize).toBeGreaterThan(smTight.bodyFontSize)
    expect(xlRelaxed.bodyLineHeight).toBeGreaterThan(smTight.bodyLineHeight)
    expect(xlRelaxed.paragraphGap).toBeGreaterThan(smTight.paragraphGap)
    expect(xlRelaxed.letterSpacing).toBeGreaterThan(smTight.letterSpacing)

    const graphiteDark = resolveThemeColors('dark', 'graphite')
    expect(graphiteDark.primary).toBe('#E4E4E7')
    expect(graphiteDark.onPrimary).toBe('#0B0D11')
  })

  it('tokenizes source code accurately and degrades oversized blocks to plain text without backtracking', () => {
    const tokens = highlightCode('// note\nconst count = 42;\nfetchJson("https://example.invalid");', 'ts')
    expect(tokens.some(t => t.kind === 'comment' && t.text === '// note')).toBe(true)
    expect(tokens.some(t => t.kind === 'keyword' && t.text === 'const')).toBe(true)
    expect(tokens.some(t => t.kind === 'number' && t.text === '42')).toBe(true)
    expect(tokens.some(t => t.kind === 'function' && t.text === 'fetchJson')).toBe(true)
    expect(tokens.some(t => t.kind === 'string' && t.text === '"https://example.invalid"')).toBe(true)

    const oversized = 'const x = 1;\n'.repeat(500)
    expect(highlightCode(oversized, 'ts')).toEqual([{ kind: 'plain', text: oversized }])
  })
})
