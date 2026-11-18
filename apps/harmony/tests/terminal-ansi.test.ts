import { build } from 'esbuild'
import { writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const etsRoot = join(here, '..', 'entry', 'src', 'main', 'ets')
const bundlePath = join(here, '.terminal-ansi-bundle.mjs')

let mod: any

beforeAll(async () => {
  const entry = `export * from ${JSON.stringify(join(etsRoot, 'services', 'TerminalAnsi.ets'))}`
  const entryPath = join(here, '.terminal-ansi-entry.ts')
  writeFileSync(entryPath, entry, 'utf8')
  try {
    const result = await build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'esm',
      write: false,
      platform: 'neutral',
      loader: { '.ets': 'ts' },
      resolveExtensions: ['.ets', '.ts', '.js']
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

describe('TerminalScreenBuffer', () => {
  it('strips SGR and OSC escapes while preserving text', () => {
    const buf = new mod.TerminalScreenBuffer(100)
    buf.append('\x1b]0;zsh\x07\x1b[32mhello\x1b[0m world\r\nline 2')
    expect(buf.text()).toBe('hello world\nline 2')
  })

  it('handles CR overwrite, erase-to-EOL, and ESC[2J screen clear', () => {
    const buf = new mod.TerminalScreenBuffer(100)
    buf.append('progress: 10%\rprogress: 99%\x1b[K')
    expect(buf.text()).toBe('progress: 99%')
    buf.append('\x1b[2J\x1b[Hfresh')
    expect(buf.text()).toBe('fresh')
  })

  it('caps scrollback lines cleanly', () => {
    const buf = new mod.TerminalScreenBuffer(3)
    buf.append('a\nb\nc\nd\ne')
    expect(buf.lineCount()).toBe(3)
    expect(buf.text()).toBe('c\nd\ne')
  })
})
