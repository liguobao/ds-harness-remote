import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HostLogStore, resolveHostLogPath } from '../src/host-log-store.js'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-remote-logs-'))
  dirs.push(dir)
  return dir
}

describe('resolveHostLogPath', () => {
  it('places logs under $DSH_HOME/logs/ds-harness-remote outside the credential store', () => {
    const filePath = resolveHostLogPath({
      env: { DSH_HOME: '/tmp/dsh-home', DSH_PROFILE: 'Desktop Main!' },
      homeDirectory: '/tmp/user-home',
    })
    expect(filePath).toBe(join('/tmp/dsh-home', 'logs', 'ds-harness-remote', 'Desktop-Main.log'))
  })

  it('falls back to ~/.dsh and host.log when env values are missing', () => {
    const filePath = resolveHostLogPath({ env: {}, homeDirectory: '/tmp/user-home' })
    expect(filePath).toBe(join('/tmp/user-home', '.dsh', 'logs', 'ds-harness-remote', 'host.log'))
  })
})

describe('HostLogStore', () => {
  it('buffers bounded entries, sanitizes newlines, and filters warn/error', async () => {
    const store = new HostLogStore({ maxEntries: 3 })
    store.record('info', 'line-1\nwith-newline', new Date('2026-11-13T10:00:00.000Z'))
    store.record('debug', 'line-2', new Date('2026-11-13T10:00:01.000Z'))
    store.record('warn', 'line-3', new Date('2026-11-13T10:00:02.000Z'))
    store.record('error', 'line-4', new Date('2026-11-13T10:00:03.000Z'))

    const all = await store.snapshot()
    expect(all.totalBuffered).toBe(3)
    expect(all.entries.map(item => item.level)).toEqual(['debug', 'warn', 'error'])
    expect(all.entries[0]?.line).toContain('2026-11-13T10:00:01.000Z [DEBUG] line-2')

    const warnOnly = await store.snapshot({ filter: 'warn' })
    expect(warnOnly.totalBuffered).toBe(3)
    expect(warnOnly.entries.map(item => item.level)).toEqual(['warn', 'error'])

    const limited = await store.snapshot({ limit: 1 })
    expect(limited.entries).toHaveLength(1)
    expect(limited.entries[0]?.line).toContain('line-4')
  })

  it('persists entries, reloads tail across restarts, rotates files, and clears disk backups', async () => {
    const dir = await tempDir()
    const filePath = join(dir, 'logs', 'ds-harness-remote', 'desktop.log')

    const first = new HostLogStore({ filePath, maxEntries: 100, maxFileBytes: 1024, maxBackups: 2 })
    for (let index = 0; index < 30; index++) {
      first.record(index % 5 === 0 ? 'warn' : 'info', `[ds-harness-remote] event-${index} payload-${'x'.repeat(80)}`)
    }
    await first.flush()

    const primaryStat = await stat(filePath)
    expect(primaryStat.size).toBeGreaterThan(0)
    await expect(stat(`${filePath}.1`)).resolves.toBeDefined()

    const second = new HostLogStore({ filePath, maxEntries: 50, maxFileBytes: 1024, maxBackups: 2 })
    second.record('error', '[ds-harness-remote] after-restart')
    const restored = await second.snapshot()
    expect(restored.filePath).toBe(filePath)
    expect(restored.fileError).toBeUndefined()
    expect(restored.entries.some(entry => entry.line.includes('after-restart'))).toBe(true)
    expect(restored.entries.some(entry => entry.line.includes('event-29'))).toBe(true)

    const cleared = await second.clear()
    expect(cleared.entries).toEqual([])
    expect(cleared.totalBuffered).toBe(0)
    expect(await readFile(filePath, 'utf8')).toBe('')
    await expect(stat(`${filePath}.1`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('degrades gracefully to memory-only when the log file path cannot be written', async () => {
    const dir = await tempDir()
    const conflictingDir = join(dir, 'occupied-dir')
    await mkdir(conflictingDir, { recursive: true })

    const store = new HostLogStore({ filePath: conflictingDir })
    store.record('info', '[ds-harness-remote] memory fallback entry')
    await store.flush()

    const snap = await store.snapshot()
    expect(snap.entries).toHaveLength(1)
    expect(snap.entries[0]?.line).toContain('memory fallback entry')
    expect(snap.fileError).toBeTruthy()

    await writeFile(join(dir, 'probe.txt'), 'ok', 'utf8')
  })
})