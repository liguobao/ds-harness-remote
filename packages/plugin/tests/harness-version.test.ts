import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

  it('rejects malformed reported versions', () => {
    expect(normalizeHarnessVersion('  ')).toBeUndefined()
    expect(normalizeHarnessVersion('0.1.0\ninvalid')).toBeUndefined()
  })

  it('separates the v0.1.5 Session V3 wire from the v0.1.2 profile', () => {
    expect(harnessSessionGeneration('0.1.2-rc.1')).toBe('legacy')
    expect(harnessSessionGeneration('dsh-v0.1.5-alpha.1')).toBe('v3')
    expect(harnessSessionGeneration('0.1.5-rc.1')).toBe('v3')
    expect(harnessSessionGeneration(undefined)).toBe('legacy')
  })
})
