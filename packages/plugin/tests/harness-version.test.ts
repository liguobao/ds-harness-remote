import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  harnessSessionGeneration,
  normalizeHarnessVersion,
  readHarnessDistributionVersion,
} from '../src/harness-version.js'

describe('Harness version discovery', () => {
  it('rejects malformed reported versions', () => {
    expect(normalizeHarnessVersion('  ')).toBeUndefined()
    expect(normalizeHarnessVersion('0.1.0\ninvalid')).toBeUndefined()
  })

  it('separates the v0.1.5 Session V3 wire from the v0.1.2 profile', () => {
    expect(harnessSessionGeneration('0.1.2-rc.1')).toBe('legacy')
    expect(harnessSessionGeneration('dsh-v0.1.5-alpha.1')).toBe('v3')
    expect(harnessSessionGeneration('0.1.5-rc.1')).toBe('v3')
    expect(harnessSessionGeneration('0.1.7-rc.1')).toBe('v3')
    expect(harnessSessionGeneration('0.2.0-rc.1')).toBe('v3')
    for (const version of ['0.2.0-rc.2', '0.2.1-alpha.1', '0.2.1-rc.1', 'dsh-v0.2.1-rc.1', '0.2.1', '0.2.2-rc.1']) {
      expect(harnessSessionGeneration(version), version).toBe('v3')
    }
    expect(harnessSessionGeneration('dsh-v0.2.0-rc.1')).toBe('v3')
    expect(harnessSessionGeneration('0.3.0')).toBe('legacy')
    expect(harnessSessionGeneration('1.0.0')).toBe('legacy')
    expect(harnessSessionGeneration(undefined)).toBe('legacy')
  })
})


describe('Harness distribution version discovery', () => {
  async function fakeInstall(root: string, version: string) {
    const pkgDir = join(root, 'node_modules', '@deepseek-ai', 'dsh')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version }))
    return pkgDir
  }
  const context = (root: string) => ({ cwd: root, execPath: join(root, 'node.exe'), globalRoots: [root] })

  it('reads the version from an absolute CLI entrypoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-version-'))
    try {
      const pkgDir = await fakeInstall(root, '0.2.2-rc.9')
      await mkdir(join(pkgDir, 'lib'), { recursive: true })
      const entry = join(pkgDir, 'lib', 'bin.js')
      await writeFile(entry, '')
      await expect(readHarnessDistributionVersion(entry, context(root))).resolves.toBe('0.2.2-rc.9')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('recovers the version from cwd and npm roots when argv[1] is empty or relative', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-version-'))
    try {
      await fakeInstall(root, '0.2.3-rc.1')
      await expect(readHarnessDistributionVersion('', context(root))).resolves.toBe('0.2.3-rc.1')
      await expect(readHarnessDistributionVersion('relative/entry.js', context(root))).resolves.toBe('0.2.3-rc.1')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('returns undefined only when no Harness manifest is discoverable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-version-'))
    try {
      const pkgDir = join(root, 'node_modules', '@deepseek-ai', 'dsh')
      await mkdir(pkgDir, { recursive: true })
      await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name: 'some-other-package', version: '9.9.9' }))
      await expect(readHarnessDistributionVersion('', context(root))).resolves.toBeUndefined()
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
