import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
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

  it('releases its lock when the operation rejects', async () => {
    const path = await directory()
    const store = new ServerCredentialStore(path)
    await expect(store.withRefreshLock(async () => { throw new Error('failed') })).rejects.toThrow('failed')
    await expect(new ServerCredentialStore(path).withRefreshLock(async () => 'recovered')).resolves.toBe('recovered')
  })
})
