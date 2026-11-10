import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { build } from 'esbuild'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServerCredentialStore } from '../src/server-credentials.js'

const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'dsh-refresh-lock-'))
  directories.push(path)
  return path
}

const marker = 'DSH_REFRESH_LOCK_V2\n'
const lockPath = (directory: string) => join(directory, 'server-credentials.json.refresh-lock')
const holderPath = (directory: string, pid: number, suffix: string) => `${lockPath(directory)}.holder-${pid}-${suffix}`

describe('credential refresh process lock', () => {
  it('allows only one process to consume the same expired credential', async () => {
    const path = await directory()
    const entry = join(path, 'store.mjs')
    await build({
      entryPoints: [fileURLToPath(new URL('../src/server-credentials.ts', import.meta.url))],
      outfile: entry, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    })
    const store = new ServerCredentialStore(path)
    await store.save({
      serverUrl: 'https://example.com', deviceId: 'test-host', authorizationMethod: 'owned_device',
      accessToken: 'expired-test-access-value', accessTokenExpiresAt: 1,
      refreshToken: 'initial-test-refresh-value', refreshTokenExpiresAt: Date.now() + 60_000,
    })
    const worker = join(path, 'worker.mjs')
    await writeFile(worker, `
      import { ServerCredentialStore } from ${JSON.stringify(pathToFileURL(entry).href)};
      const store = new ServerCredentialStore(process.argv[2]);
      await store.withRefreshLock(async () => {
        const stored = await store.load('https://example.com', 'test-host');
        if (stored.accessTokenExpiresAt > Date.now()) { process.stdout.write('cached'); return; }
        await new Promise(resolve => setTimeout(resolve, 150));
        await store.save({ ...stored, accessToken: 'rotated-test-access-value',
          refreshToken: 'rotated-test-refresh-value', accessTokenExpiresAt: Date.now() + 60_000 });
        process.stdout.write('refreshed');
      });
    `)
    const run = promisify(execFile)
    const results = await Promise.all([run(process.execPath, [worker, path]), run(process.execPath, [worker, path])])
    expect(results.map(result => result.stdout).sort()).toEqual(['cached', 'refreshed'])
    expect(await readFile(lockPath(path), 'utf8')).toBe(marker)
    expect((await readdir(path)).filter(name => name.includes('.refresh-lock.holder-'))).toEqual([])
  })

  it.each(['directory', 'file'] as const)('does not take over a legacy %s lock', async kind => {
    const path = await directory()
    const lock = join(path, 'server-credentials.json.refresh-lock')
    if (kind === 'directory') await mkdir(lock)
    else await writeFile(lock, '123 00000000-0000-7000-8000-000000000000\n')
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(16_000)
    const operation = vi.fn()
    await expect(new ServerCredentialStore(path).withRefreshLock(operation)).rejects.toMatchObject({ code: 'SERVER_CREDENTIALS_BUSY' })
    expect(operation).not.toHaveBeenCalled()
    expect((await stat(lock)).isDirectory()).toBe(kind === 'directory')
  })

  it('recovers a lock after its owner process exits during refresh', async () => {
    const path = await directory()
    const entry = join(path, 'store.mjs')
    await build({
      entryPoints: [fileURLToPath(new URL('../src/server-credentials.ts', import.meta.url))],
      outfile: entry, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    })
    const worker = join(path, 'crash-worker.mjs')
    await writeFile(worker, `
      import { ServerCredentialStore } from ${JSON.stringify(pathToFileURL(entry).href)};
      await new ServerCredentialStore(process.argv[2]).withRefreshLock(async () => {
        process.stdout.write('locked');
        await new Promise(() => {});
      });
    `)
    const child = spawn(process.execPath, [worker, path], { stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      await once(child.stdout!, 'data')
      const lock = lockPath(path)
      expect(await readFile(lock, 'utf8')).toBe(marker)
      expect((await readdir(path)).filter(name => name.includes('.refresh-lock.holder-'))).toHaveLength(1)
      child.kill('SIGKILL')
      await once(child, 'exit')
      await expect(new ServerCredentialStore(path).withRefreshLock(async () => 'recovered')).resolves.toBe('recovered')
      expect(await readFile(lock, 'utf8')).toBe(marker)
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  })

  it.each(['choosing', '1'] as const)('does not pass a live %s owner or invalid record', async state => {
    const path = await directory()
    await writeFile(lockPath(path), marker)
    const holder = holderPath(path, process.pid, '00000000-0000-7000-8000-000000000000')
    await writeFile(holder, `${process.pid}-00000000-0000-7000-8000-000000000000 ${state}\n`)
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(16_000)
    await expect(new ServerCredentialStore(path).withRefreshLock(async () => 'stolen')).rejects.toMatchObject({ code: 'SERVER_CREDENTIALS_BUSY' })
    await writeFile(holder, 'invalid')
    vi.mocked(Date.now).mockReturnValueOnce(0)
    await expect(new ServerCredentialStore(path).withRefreshLock(async () => 'stolen')).rejects.toMatchObject({ code: 'SERVER_CREDENTIALS_BUSY' })
  })

  it('ignores a dead process that exits before it publishes a ticket', async () => {
    const path = await directory()
    await writeFile(lockPath(path), marker)
    const owner = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const ownerPid = owner.pid!
    owner.kill('SIGKILL')
    await once(owner, 'exit')
    const holder = holderPath(path, ownerPid, '00000000-0000-7000-8000-000000000001')
    await writeFile(holder, `${ownerPid}-00000000-0000-7000-8000-000000000001 choosing\n`)
    await expect(new ServerCredentialStore(path).withRefreshLock(async () => 'recovered')).resolves.toBe('recovered')
    await expect(stat(holder)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('serializes two processes despite the same dead holder and takeover claim', async () => {
    const path = await directory()
    const entry = join(path, 'store.mjs')
    await build({
      entryPoints: [fileURLToPath(new URL('../src/server-credentials.ts', import.meta.url))],
      outfile: entry, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    })
    const owner = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const ownerPid = owner.pid!
    owner.kill('SIGKILL')
    await once(owner, 'exit')
    await writeFile(lockPath(path), marker)
    const holder = holderPath(path, ownerPid, '00000000-0000-7000-8000-000000000003')
    await writeFile(holder, `${ownerPid}-00000000-0000-7000-8000-000000000003 1\n`)
    const oldClaim = `${lockPath(path)}.takeover-dead`
    await writeFile(oldClaim, `${ownerPid}\n`)
    const worker = join(path, 'recover-worker.mjs')
    await writeFile(worker, `
      import { appendFile } from 'node:fs/promises';
      import { ServerCredentialStore } from ${JSON.stringify(pathToFileURL(entry).href)};
      await new ServerCredentialStore(process.argv[2]).withRefreshLock(async () => {
        await appendFile(process.argv[3], 'start\\n');
        await new Promise(resolve => setTimeout(resolve, 100));
        await appendFile(process.argv[3], 'done\\n');
      });
    `)
    const events = join(path, 'events')
    const run = promisify(execFile)
    await Promise.all([run(process.execPath, [worker, path, events]), run(process.execPath, [worker, path, events])])
    expect(await readFile(events, 'utf8')).toBe('start\ndone\nstart\ndone\n')
    await expect(stat(holder)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(oldClaim, 'utf8')).toBe(`${ownerPid}\n`)
  })

  it('ignores a complete but unpublished lock record after its writer dies', async () => {
    const path = await directory()
    const lock = join(path, 'server-credentials.json.refresh-lock')
    const unpublished = `${lock}.holder-123-00000000-0000-7000-8000-000000000002.123.00000000-0000-7000-8000-000000000002.tmp`
    await writeFile(unpublished, '123-00000000-0000-7000-8000-000000000002 choosing\n')
    await expect(new ServerCredentialStore(path).withRefreshLock(async () => 'acquired')).resolves.toBe('acquired')
    expect(await readFile(lock, 'utf8')).toBe(marker)
  })

  it.skipIf(process.platform !== 'win32')('checks exited and live owner PIDs on Windows', async () => {
    const path = await directory()
    await writeFile(lockPath(path), marker)
    const exited = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const exitedPid = exited.pid!
    exited.kill('SIGKILL')
    await once(exited, 'exit')
    await writeFile(holderPath(path, exitedPid, '00000000-0000-7000-8000-000000000004'),
      `${exitedPid}-00000000-0000-7000-8000-000000000004 1\n`)
    await expect(new ServerCredentialStore(path).withRefreshLock(async () => 'recovered')).resolves.toBe('recovered')

    const live = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    try {
      await writeFile(holderPath(path, live.pid!, '00000000-0000-7000-8000-000000000005'),
        `${live.pid}-00000000-0000-7000-8000-000000000005 1\n`)
      vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(16_000)
      await expect(new ServerCredentialStore(path).withRefreshLock(async () => 'stolen')).rejects.toMatchObject({ code: 'SERVER_CREDENTIALS_BUSY' })
    } finally {
      live.kill('SIGKILL')
      await once(live, 'exit')
    }
  })

  it('releases its lock when the operation rejects', async () => {
    const path = await directory()
    const store = new ServerCredentialStore(path)
    await expect(store.withRefreshLock(async () => { throw new Error('failed') })).rejects.toThrow('failed')
    await expect(new ServerCredentialStore(path).withRefreshLock(async () => 'recovered')).resolves.toBe('recovered')
  })
})
