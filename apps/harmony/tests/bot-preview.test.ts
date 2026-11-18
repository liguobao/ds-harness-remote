import { build } from 'esbuild'
import { writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const temp = join(here, '.bot-preview-bundle.mjs')
let preview: (outline: { turnId: string, prompt: string, response: string }[], hidden: unknown[]) => string
beforeAll(async () => {
  const source = join(here, '..', 'entry', 'src', 'main', 'ets', 'util', 'BotPreview.ets')
  const result = await build({ entryPoints: [source], bundle: true, format: 'esm', write: false,
    platform: 'neutral', loader: { '.ets': 'ts' }, resolveExtensions: ['.ets', '.ts', '.js'] })
  writeFileSync(temp, result.outputFiles[0].text)
  preview = (await import(`file://${temp}`)).botOutlinePreview
})
afterAll(() => rmSync(temp, { force: true }))

describe('Bot inbox preview', () => {
  it('shows the latest visible response and excludes internal exchanges', () => {
    const rows = [
      { turnId: '1', prompt: 'Question', response: '[Reply from Bot]\nHello   world' },
      { turnId: '2', prompt: 'private exchange', response: 'hidden response' },
    ]
    expect(preview(rows, [2])).toBe('Hello world')
    expect(preview(rows, [])).toBe('hidden response')
  })
  it('falls back to a prompt and returns empty when every turn is hidden', () => {
    const rows = [{ turnId: '3', prompt: '  Draft\nquestion ', response: '' }]
    expect(preview(rows, [])).toBe('Draft question')
    expect(preview(rows, ['3'])).toBe('')
  })
})
