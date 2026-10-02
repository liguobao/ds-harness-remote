import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  harnessSessionGeneration,
  normalizeHarnessVersion,
  readHarnessDistributionVersion,
  selectHarnessVersion,
} from '../src/harness-version.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('Harness version discovery', () => {
  it('prefers a valid host.describe version', () => {
    expect(selectHarnessVersion('0.1.0-rc.8', '0.1.0-rc.6')).toBe('0.1.0-rc.8')
  })

  it('replaces the legacy host.describe placeholder with the distribution version', () => {
    expect(selectHarnessVersion('0.0.1', '0.1.0-rc.6')).toBe('0.1.0-rc.6')
  })

  it('finds the running DSH package manifest from its CLI entrypoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-version-'))
    directories.push(root)
    const lib = join(root, 'lib')
    await mkdir(lib)
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.6' }))

    await expect(readHarnessDistributionVersion(join(lib, 'bin.js'))).resolves.toBe('0.1.0-rc.6')
  })

  it('resolves a globally installed CLI symlink before reading the DSH manifest', async () => {
    if (process.platform === 'win32') return
    const root = await mkdtemp(join(tmpdir(), 'dsh-version-'))
    directories.push(root)
    const lib = join(root, 'lib')
    const bin = join(root, 'bin')
    await mkdir(lib)
    await mkdir(bin)
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0-rc.2' }))
    await writeFile(join(lib, 'bin.js'), '')
    await symlink('../lib/bin.js', join(bin, 'dsh'))

    await expect(readHarnessDistributionVersion(join(bin, 'dsh'))).resolves.toBe('0.2.0-rc.2')
  })

  it('resolves the Harness package beside a desktop-shell entrypoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-version-'))
    directories.push(root)
    const scope = join(root, 'node_modules', '@deepseek-ai')
    const shell = join(scope, 'dsh-desktop-host')
    const harness = join(scope, 'dsh')
    await mkdir(join(shell, 'lib'), { recursive: true })
    await mkdir(harness, { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop', version: '0.2.0-rc.2' }))
    await writeFile(join(shell, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop-host', version: '0.2.0-rc.2' }))
    await writeFile(join(harness, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh',
      version: '0.2.0-rc.2',
      exports: { './package.json': './package.json' },
    }))

    await expect(readHarnessDistributionVersion(join(shell, 'lib', 'index.js'))).resolves.toBe('0.2.0-rc.2')
  })

  it('omits the distribution version when no entrypoint scope carries the Harness package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-version-'))
    directories.push(root)
    const shell = join(root, 'node_modules', '@deepseek-ai', 'dsh-desktop-host')
    await mkdir(join(shell, 'lib'), { recursive: true })
    await writeFile(join(shell, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-desktop-host', version: '0.2.0-rc.2' }))

    await expect(readHarnessDistributionVersion(join(shell, 'lib', 'index.js'))).resolves.toBeUndefined()
  })

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
    expect(harnessSessionGeneration('0.2.0-rc.2')).toBe('v3')
    expect(harnessSessionGeneration('dsh-v0.2.0-rc.1')).toBe('v3')
    expect(harnessSessionGeneration('0.3.0')).toBe('legacy')
    expect(harnessSessionGeneration('1.0.0')).toBe('legacy')
    expect(harnessSessionGeneration(undefined)).toBe('legacy')
  })
})
