import { build } from 'esbuild'
import { writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const etsRoot = join(here, '..', 'entry', 'src', 'main', 'ets')
const entryPath = join(here, '.workspace-grouping-entry.ts')
const bundlePath = join(here, '.workspace-grouping-bundle.mjs')

interface GroupingModule {
  HarnessRemoteSession: new () => {
    sessionId: string
    title: string
    cwd: string
    updatedAt: number
  }
  HarnessWorkspace: new () => {
    workspaceId: string
    title: string
    path: string
    sessionIds: string[]
  }
  groupSessionsByWorkspace: (
    workspaces: unknown[],
    sessions: unknown[],
    currentSessionId: string,
    selectedWorkspaceId: string
  ) => Array<{
    workspaceId: string
    title: string
    totalCount: number
    hasCurrent: boolean
    isSynthetic: boolean
    sessions: Array<{ sessionId: string }>
  }>
  formatRelativeShort: (updatedAt: number, nowMs?: number) => string
}

let mod!: GroupingModule

beforeAll(async () => {
  writeFileSync(
    entryPath,
    [
      `export { groupSessionsByWorkspace, formatRelativeShort } from ${JSON.stringify(join(etsRoot, 'util', 'WorkspaceGrouping.ets'))}`,
      `export { HarnessRemoteSession, HarnessWorkspace } from ${JSON.stringify(join(etsRoot, 'net', 'HarnessClient.ets'))}`
    ].join('\n'),
    'utf8'
  )
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
          setup(b) {
            b.onResolve({ filter: /^@(kit|ohos)\./ }, args => ({ path: args.path, namespace: 'kit-stub' }))
            b.onLoad({ filter: /.*/, namespace: 'kit-stub' }, () => ({
              contents: 'export const cryptoFramework = { createRandom: () => ({ generateRandomSync: (n) => ({ data: new Uint8Array(n) }) }) }; export const hilog = { info: () => undefined, warn: () => undefined, error: () => undefined };',
              loader: 'js'
            }))
          }
        }
      ]
    })
    writeFileSync(bundlePath, result.outputFiles[0].text, 'utf8')
  } finally {
    rmSync(entryPath, { force: true })
  }
  mod = (await import(`file://${bundlePath}`)) as GroupingModule
})

afterAll(() => {
  rmSync(bundlePath, { force: true })
})

describe('WorkspaceGrouping', () => {
  it('groups declared workspaces and falls back by normalized cwd', () => {
    const ws1 = new mod.HarnessWorkspace()
    ws1.workspaceId = 'w1'
    ws1.title = 'DS Bot'
    ws1.path = '/Users/test/ds-bot/'
    ws1.sessionIds = ['s1']

    const ws2 = new mod.HarnessWorkspace()
    ws2.workspaceId = 'w2'
    ws2.title = 'default-workspace'
    ws2.path = '/Users/test/default'
    ws2.sessionIds = []

    const s1 = new mod.HarnessRemoteSession()
    s1.sessionId = 's1'
    s1.title = 'Bot Thread'
    s1.cwd = '/Users/test/ds-bot'
    s1.updatedAt = 1000

    const s2 = new mod.HarnessRemoteSession()
    s2.sessionId = 's2'
    s2.title = 'Default Newer'
    s2.cwd = '/Users/test/default/'
    s2.updatedAt = 3000

    const s3 = new mod.HarnessRemoteSession()
    s3.sessionId = 's3'
    s3.title = 'Default Older'
    s3.cwd = '/Users/test/default'
    s3.updatedAt = 2000

    const s4 = new mod.HarnessRemoteSession()
    s4.sessionId = 's4'
    s4.title = 'Unlisted Folder'
    s4.cwd = '/Users/test/other-proj'
    s4.updatedAt = 1500

    const groups = mod.groupSessionsByWorkspace([ws1, ws2], [s1, s2, s3, s4], 's3', '')
    expect(groups.map(g => g.title)).toEqual(['DS Bot', 'default-workspace', 'other-proj'])
    expect(groups[0].totalCount).toBe(1)
    expect(groups[1].sessions.map(s => s.sessionId)).toEqual(['s2', 's3'])
    expect(groups[1].hasCurrent).toBe(true)
    expect(groups[2].isSynthetic).toBe(true)
  })

  it('formats compact relative timestamps matching Android drawer', () => {
    const now = 1_700_000_000_000
    expect(mod.formatRelativeShort(0, now)).toBe('')
    expect(mod.formatRelativeShort(now - 5 * 60_000, now)).toBe('5m')
    expect(mod.formatRelativeShort(now - 16 * 3600_000, now)).toBe('16h')
    expect(mod.formatRelativeShort(now - 3 * 86400_000, now)).toBe('3d')
  })
})
