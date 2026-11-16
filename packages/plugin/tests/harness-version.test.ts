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
  const context = (root: string) => ({
    cwd: root,
    execPath: join(root, 'node.exe'),
    globalRoots: [root],
    // Keep discovery hermetic: never inherit DSHM_CORE_DIR from the host and ignore external module scope.
    env: {} as NodeJS.ProcessEnv,
    moduleScope: null,
  })

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

describe('Harness version discovery on in-process DSHM hosts', () => {
  async function fakeCoreInstall(coreDir: string, version: string) {
    const pkgDir = join(coreDir, 'node_modules', '@deepseek-ai', 'dsh')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version }))
    return pkgDir
  }
  /**
   * HarmonyOS host application: `main.js` calls runProfile in-process, so the
   * executable, the working directory and the global npm roots hold no Harness
   * install at all.
   */
  const hostContext = (appDir: string, env?: NodeJS.ProcessEnv) => ({
    cwd: appDir,
    execPath: join(appDir, 'main.exe'),
    globalRoots: [] as string[],
    env,
    moduleScope: null,
  })

  it('discovers the version through DSHM_CORE_DIR and selects Session V3', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshm-version-'))
    try {
      const coreDir = join(root, 'core')
      await fakeCoreInstall(coreDir, '0.2.2-rc.1')
      const version = await readHarnessDistributionVersion('', hostContext(join(root, 'app'), { DSHM_CORE_DIR: coreDir }))
      expect(version).toBe('0.2.2-rc.1')
      expect(harnessSessionGeneration(version)).toBe('v3')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('discovers the version through injectable moduleScope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshm-scope-'))
    try {
      await fakeCoreInstall(root, '0.2.2-rc.1')
      const fakeEntry = join(root, 'entry.js')
      await writeFile(fakeEntry, '')
      const version = await readHarnessDistributionVersion('', {
        cwd: tmpdir(),
        execPath: '',
        globalRoots: [],
        env: {},
        moduleScope: fakeEntry,
      })
      expect(version).toBe('0.2.2-rc.1')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('trims surrounding whitespace in DSHM_CORE_DIR', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshm-version-'))
    try {
      const coreDir = join(root, 'core')
      await fakeCoreInstall(coreDir, '0.2.2-rc.1')
      await expect(
        readHarnessDistributionVersion('', hostContext(join(root, 'app'), { DSHM_CORE_DIR: `  ${coreDir}  ` })),
      ).resolves.toBe('0.2.2-rc.1')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('accepts a DSHM_CORE_DIR that is itself the Harness package root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshm-version-'))
    try {
      const coreDir = join(root, 'core')
      await mkdir(coreDir, { recursive: true })
      await writeFile(join(coreDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.2' }))
      await expect(
        readHarnessDistributionVersion('', hostContext(join(root, 'app'), { DSHM_CORE_DIR: coreDir })),
      ).resolves.toBe('0.2.2')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('resolves relative DSHM_CORE_DIR against context cwd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshm-version-'))
    try {
      const coreDir = join(root, 'app', 'embedded-core')
      await fakeCoreInstall(coreDir, '0.2.2-rc.1')
      await expect(
        readHarnessDistributionVersion('', hostContext(join(root, 'app'), { DSHM_CORE_DIR: './embedded-core' })),
      ).resolves.toBe('0.2.2-rc.1')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('reads DSHM_CORE_DIR from process.env when no lookup context is supplied', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshm-version-'))
    const previous = process.env.DSHM_CORE_DIR
    try {
      const coreDir = join(root, 'core')
      await fakeCoreInstall(coreDir, '0.2.2-rc.1')
      process.env.DSHM_CORE_DIR = coreDir
      await expect(readHarnessDistributionVersion('', { moduleScope: null })).resolves.toBe('0.2.2-rc.1')
    } finally {
      if (previous === undefined) delete process.env.DSHM_CORE_DIR
      else process.env.DSHM_CORE_DIR = previous
      await rm(root, { recursive: true, force: true })
    }
  })

  it('falls back to process.env when context has no env property', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshm-version-'))
    const previous = process.env.DSHM_CORE_DIR
    try {
      const coreDir = join(root, 'core')
      await fakeCoreInstall(coreDir, '0.2.2-rc.1')
      process.env.DSHM_CORE_DIR = coreDir
      const appDir = join(root, 'app')
      const contextWithoutEnv = {
        cwd: appDir,
        execPath: join(appDir, 'main.exe'),
        globalRoots: [] as string[],
        moduleScope: null,
      }
      await expect(readHarnessDistributionVersion('', contextWithoutEnv)).resolves.toBe('0.2.2-rc.1')
    } finally {
      if (previous === undefined) delete process.env.DSHM_CORE_DIR
      else process.env.DSHM_CORE_DIR = previous
      await rm(root, { recursive: true, force: true })
    }
  })

  it('falls back safely when DSHM_CORE_DIR is unset, blank, or not a Harness install', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshm-version-'))
    try {
      const appDir = join(root, 'app')
      const cases: Array<{ label: string; env: NodeJS.ProcessEnv }> = [
        { label: 'unset-env', env: {} },
        { label: 'empty-string', env: { DSHM_CORE_DIR: '' } },
        { label: 'whitespace-only', env: { DSHM_CORE_DIR: '   ' } },
        { label: 'absent-directory', env: { DSHM_CORE_DIR: join(root, 'absent-core') } },
      ]
      for (const item of cases) {
        await expect(readHarnessDistributionVersion('', hostContext(appDir, item.env)), item.label).resolves.toBeUndefined()
      }

      // Foreign manifest inside core package root must be rejected
      const impostorRoot = join(root, 'impostor-root')
      await mkdir(impostorRoot, { recursive: true })
      await writeFile(join(impostorRoot, 'package.json'), JSON.stringify({ name: 'not-the-harness', version: '0.2.2-rc.1' }))
      await expect(
        readHarnessDistributionVersion('', hostContext(appDir, { DSHM_CORE_DIR: impostorRoot })),
      ).resolves.toBeUndefined()

      // Foreign manifest inside node_modules/@deepseek-ai/dsh must also be rejected
      const impostorModule = join(root, 'impostor-module')
      const impostorPkg = join(impostorModule, 'node_modules', '@deepseek-ai', 'dsh')
      await mkdir(impostorPkg, { recursive: true })
      await writeFile(join(impostorPkg, 'package.json'), JSON.stringify({ name: 'not-dsh', version: '0.2.2-rc.1' }))
      await expect(
        readHarnessDistributionVersion('', hostContext(appDir, { DSHM_CORE_DIR: impostorModule })),
      ).resolves.toBeUndefined()

      // Malformed package.json (non-JSON, missing version, non-string version) must fall back gracefully
      const malformedModule = join(root, 'malformed-module')
      const malformedPkg = join(malformedModule, 'node_modules', '@deepseek-ai', 'dsh')
      await mkdir(malformedPkg, { recursive: true })
      await writeFile(join(malformedPkg, 'package.json'), '{ broken json')
      await expect(
        readHarnessDistributionVersion('', hostContext(appDir, { DSHM_CORE_DIR: malformedModule })),
      ).resolves.toBeUndefined()

      await writeFile(join(malformedPkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: 12345 }))
      await expect(
        readHarnessDistributionVersion('', hostContext(appDir, { DSHM_CORE_DIR: malformedModule })),
      ).resolves.toBeUndefined()
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
