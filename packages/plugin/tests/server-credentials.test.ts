import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
    await expect(stat(join(path, 'server-credentials.json.refresh-lock'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not steal a lock after the wait deadline', async () => {
    const path = await directory()
    const lock = join(path, 'server-credentials.json.refresh-lock')
    await mkdir(lock)
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(16_000)
    const operation = vi.fn()
    await expect(new ServerCredentialStore(path).withRefreshLock(operation)).rejects.toMatchObject({ code: 'SERVER_CREDENTIALS_BUSY' })
    expect(operation).not.toHaveBeenCalled()
    expect((await stat(lock)).isDirectory()).toBe(true)
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
      const lock = join(path, 'server-credentials.json.refresh-lock')
      expect((await stat(lock)).isFile()).toBe(true)
      child.kill('SIGKILL')
      await once(child, 'exit')
      await expect(new ServerCredentialStore(path).withRefreshLock(async () => 'recovered')).resolves.toBe('recovered')
      await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  })

  it('does not reclaim a live owner or an unreadable owner record', async () => {
    const path = await directory()
    const lock = join(path, 'server-credentials.json.refresh-lock')
    await writeFile(lock, `${process.pid} 00000000-0000-7000-8000-000000000000\n`)
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(16_000)
    await expect(new ServerCredentialStore(path).withRefreshLock(async () => 'stolen')).rejects.toMatchObject({ code: 'SERVER_CREDENTIALS_BUSY' })
    await writeFile(lock, 'invalid')
    vi.mocked(Date.now).mockReturnValueOnce(0)
    await expect(new ServerCredentialStore(path).withRefreshLock(async () => 'stolen')).rejects.toMatchObject({ code: 'SERVER_CREDENTIALS_BUSY' })
  })

  it('recovers when a takeover process dies before removing the original lock', async () => {
    const path = await directory()
    const lock = join(path, 'server-credentials.json.refresh-lock')
    const owner = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const ownerPid = owner.pid!
    owner.kill('SIGKILL')
    await once(owner, 'exit')
    const record = `${ownerPid} 00000000-0000-7000-8000-000000000001\n`
    await writeFile(lock, record)
    const claim = `${lock}.takeover-${createHash('sha256').update(record).digest('hex').slice(0, 16)}`
    const reaper = spawn(process.execPath, ['-e', `
      const fs = require('node:fs');
      fs.writeFileSync(process.argv[1], process.pid + '\\n');
      process.stdout.write('claimed');
      setInterval(() => {}, 1000);
    `, claim], { stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      await once(reaper.stdout!, 'data')
      reaper.kill('SIGKILL')
      await once(reaper, 'exit')
      await expect(new ServerCredentialStore(path).withRefreshLock(async () => 'recovered')).resolves.toBe('recovered')
      await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(claim)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      if (reaper.exitCode === null) reaper.kill('SIGKILL')
    }
  })

  it('serializes two processes that recover the same dead lock', async () => {
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
    const lock = join(path, 'server-credentials.json.refresh-lock')
    await writeFile(lock, `${ownerPid} 00000000-0000-7000-8000-000000000003\n`)
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
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('ignores a complete but unpublished lock record after its writer dies', async () => {
    const path = await directory()
    const lock = join(path, 'server-credentials.json.refresh-lock')
    const unpublished = `${lock}.123.00000000-0000-7000-8000-000000000002.tmp`
    await writeFile(unpublished, '123 00000000-0000-7000-8000-000000000002\n')
    await expect(new ServerCredentialStore(path).withRefreshLock(async () => 'acquired')).resolves.toBe('acquired')
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.skipIf(process.platform !== 'win32')('checks exited and live owner PIDs on Windows', async () => {
    const path = await directory()
    const lock = join(path, 'server-credentials.json.refresh-lock')
    const exited = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    const exitedPid = exited.pid!
    exited.kill('SIGKILL')
    await once(exited, 'exit')
    await writeFile(lock, `${exitedPid} 00000000-0000-7000-8000-000000000004\n`)
    await expect(new ServerCredentialStore(path).withRefreshLock(async () => 'recovered')).resolves.toBe('recovered')

    const live = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    try {
      await writeFile(lock, `${live.pid} 00000000-0000-7000-8000-000000000005\n`)
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
