/**
 * Unit tests for SyntaxHighlight, MentionAndQuote (mentions, quotes, rich markdown blocks).
 */
import { build } from 'esbuild'
import { writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const etsRoot = join(here, '..', 'entry', 'src', 'main', 'ets')
const bundlePath = join(here, '.rich-chat-bundle.mjs')

const kitStub = `
export const cryptoFramework = {
  createRandom: () => ({ generateRandomSync: (len) => ({ data: new Uint8Array(len) }) })
}
export const network = {}
export const webSocket = {}
export const hilog = { info: () => undefined, warn: () => undefined, error: () => undefined }
`

let mod: any

beforeAll(async () => {
  const entry = `
export * from ${JSON.stringify(join(etsRoot, 'util', 'SyntaxHighlight.ets'))}
export * from ${JSON.stringify(join(etsRoot, 'util', 'MentionAndQuote.ets'))}
`
  const entryPath = join(here, '.rich-chat-entry.ts')
  writeFileSync(entryPath, entry, 'utf8')
  try {
    const result = await build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'esm',
      write: false,
      platform: 'neutral',
      loader: { '.ets': 'ts' },
      resolveExtensions: ['.ets', '.ts', '.js'],
      plugins: [
        {
          name: 'kit-stub',
          setup(pluginBuild) {
            pluginBuild.onResolve({ filter: /^@kit\./ }, () => ({ path: 'kit', namespace: 'kit-stub' }))
            pluginBuild.onLoad({ filter: /.*/, namespace: 'kit-stub' }, () => ({
              contents: kitStub,
              loader: 'ts'
            }))
          }
        }
      ]
    })
    writeFileSync(bundlePath, result.outputFiles[0].text, 'utf8')
  } finally {
    rmSync(entryPath, { force: true })
  }
  mod = await import(`file://${bundlePath}`)
})

afterAll(() => {
  rmSync(bundlePath, { force: true })
})

describe('SyntaxHighlight', () => {
  it('tokenizes keywords, strings, numbers, comments, and functions accurately', () => {
    const code = 'const n = 42 // answer\ngreet("hi")'
    const tokens = mod.highlightCode(code, 'ts')
    expect(tokens.some((t: any) => t.kind === 'keyword' && t.text === 'const')).toBe(true)
    expect(tokens.some((t: any) => t.kind === 'number' && t.text === '42')).toBe(true)
    expect(tokens.some((t: any) => t.kind === 'comment' && t.text === '// answer')).toBe(true)
    expect(tokens.some((t: any) => t.kind === 'function' && t.text === 'greet')).toBe(true)
    expect(tokens.some((t: any) => t.kind === 'string' && t.text === '"hi"')).toBe(true)
  })
})

describe('MentionAndQuote', () => {
  it('detects /commands and @context mentions including quoted filenames', () => {
    const cmd = mod.detectMention('/comp', 5)
    expect(cmd.type).toBe('command')
    expect(cmd.query).toBe('comp')
    expect(cmd.start).toBe(0)

    const ctx = mod.detectMention('check @src/app', 14)
    expect(ctx.type).toBe('context')
    expect(ctx.query).toBe('src/app')
    expect(ctx.start).toBe(6)

    const quoted = mod.detectMention('see @"my doc', 12)
    expect(quoted.type).toBe('context')
    expect(quoted.query).toBe('my doc')

    expect(mod.fileMentionText('docs/my file.md', false)).toBe('@"docs/my file.md" ')
    expect(mod.fileMentionText('src', true)).toBe('@src/ ')
    expect(mod.sessionMentionText('sess-1', 'Fix [bug]')).toContain('(dsh-session:')
  })

  it('parses leading quotes cleanly and formats quote replies', () => {
    const quoted = mod.formatQuoteText('line 1\nline 2')
    expect(quoted).toBe('> line 1\n> line 2')
    const parsed = mod.parseMessageQuotes('> line 1\n> line 2\n\nmy reply')
    expect(parsed.quotes).toEqual(['line 1\nline 2'])
    expect(parsed.body).toBe('my reply')
  })

  it('parses fenced code, mermaid, tables, and math into RichBlocks', () => {
    const md = [
      '# Title',
      '> quoted context',
      '',
      '$$',
      '\\alpha + \\frac{1}{2}',
      '$$',
      '',
      '| ColA | ColB |',
      '| ---- | ---- |',
      '| a | b |',
      '',
      '```mermaid',
      'graph TD; A-->B;',
      '```',
      '',
      'Inline $x \\le y$.'
    ].join('\n')
    const blocks = mod.parseRichBlocks(md)
    expect(blocks.map((b: any) => b.kind)).toEqual([
      'heading',
      'quote',
      'math',
      'table',
      'mermaid',
      'paragraph'
    ])
    expect(blocks[2].text).toContain('\\alpha')
    expect(blocks[3].headers).toEqual(['ColA', 'ColB'])
    expect(blocks[3].rows).toEqual([['a', 'b']])
    expect(blocks[5].text).toContain('x ≤ y')
  })
})
