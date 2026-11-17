/**
 * Conformance tests for HarmonyOS session-list visibility.
 *
 * The rule mirrors Desktop `sessionVisible` and Android
 * `apps/android/src/lib/session-visibility.ts`: only the current blank placeholder is
 * listed and blank placeholders never match a search query; `subagent` sessions stay
 * out of the flat list. The function is pure, so the .ets source is bundled with esbuild
 * exactly like the crypto/client tests do.
 */
import { build } from 'esbuild'
import { writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const etsRoot = join(here, '..', 'entry', 'src', 'main', 'ets')
const entryPath = join(here, '.session-visibility-entry.ts')
const bundlePath = join(here, '.session-visibility-bundle.mjs')

interface VisibilityModule {
  isVisibleSession(sessionId: string, blank: boolean, origin: string,
    currentSessionId: string, searchQuery: string): boolean
}

let visibility!: VisibilityModule

beforeAll(async () => {
  writeFileSync(entryPath,
    `export { isVisibleSession } from ${JSON.stringify(join(etsRoot, 'util', 'SessionVisibility.ets'))}\n`,
    'utf8')
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
  visibility = (await import(`file://${bundlePath}`)) as VisibilityModule
})

afterAll(() => {
  rmSync(bundlePath, { force: true })
})

describe('session visibility', () => {
  it('lists ordinary sessions', () => {
    expect(visibility.isVisibleSession('session-1', false, '', 'session-1', '')).toBe(true)
    expect(visibility.isVisibleSession('session-1', false, '', '', '')).toBe(true)
    expect(visibility.isVisibleSession('session-1', false, 'user', 'session-2', 'query')).toBe(true)
  })

  it('keeps only the current blank placeholder', () => {
    expect(visibility.isVisibleSession('blank-1', true, '', 'blank-1', '')).toBe(true)
    expect(visibility.isVisibleSession('blank-1', true, '', 'other', '')).toBe(false)
    expect(visibility.isVisibleSession('blank-1', true, '', '', '')).toBe(false)
  })

  it('never lets blank placeholders match a search query', () => {
    expect(visibility.isVisibleSession('blank-1', true, '', 'blank-1', 'hello')).toBe(false)
    expect(visibility.isVisibleSession('blank-1', true, '', 'blank-1', '   ')).toBe(true)
  })

  it('hides subagent sessions', () => {
    expect(visibility.isVisibleSession('sub-1', false, 'subagent', '', '')).toBe(false)
    expect(visibility.isVisibleSession('sub-1', true, 'subagent', 'sub-1', '')).toBe(false)
    expect(visibility.isVisibleSession('sub-1', false, 'subagent', '', 'query')).toBe(false)
  })
})
