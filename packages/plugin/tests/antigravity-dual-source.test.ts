import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ANTIGRAVITY_CLI_ROOT_ENV,
  ANTIGRAVITY_DESKTOP_ROOT_ENV,
  antigravityEnds,
  resolveAntigravityEnds,
  type AntigravityEnd,
} from '../src/acp/adapters/antigravity/antigravity-paths.js'
import {
  discoverAntigravitySessions,
  discoverAntigravityWorkspaces,
  loadTranscriptEvents,
} from '../src/acp/adapters/antigravity/transcript-loader.js'
import {
  hasCliSession,
  syncDesktopSessionForResume,
  type SessionSyncOptions,
} from '../src/acp/adapters/antigravity/session-sync.js'
import { TranscriptWatcher } from '../src/acp/adapters/antigravity/transcript-watcher.js'
import { AntigravityAcpClient } from '../src/acp/adapters/antigravity-process.js'
import type { SafeLogger } from '../src/logging.js'

const nodeRequire = createRequire(import.meta.url)

interface TestEnd extends AntigravityEnd {
  root: string
}

async function makeEnd(name: string): Promise<TestEnd> {
  const root = await fs.mkdtemp(join(tmpdir(), `agy-dual-${name}-`))
  const end: TestEnd = {
    source: name === 'desktop' ? 'desktop' : 'cli',
    root,
    dbPath: join(root, 'conversation_summaries.db'),
    brainDir: join(root, 'brain'),
    conversationsDir: join(root, 'conversations'),
  }
  await fs.mkdir(end.brainDir, { recursive: true })
  await fs.mkdir(end.conversationsDir, { recursive: true })
  createDb(end.dbPath)
  return end
}

function sqlite(): typeof import('node:sqlite') {
  return nodeRequire('node:sqlite') as typeof import('node:sqlite')
}

function createDb(dbPath: string, columns = 'conversation_id TEXT, title TEXT, workspace_uris TEXT, step_count INTEGER, last_modified_time TEXT'): void {
  const db = new (sqlite().DatabaseSync)(dbPath)
  try {
    db.exec(`CREATE TABLE conversation_summaries (${columns})`)
  } finally {
    db.close()
  }
}

function rowValues(dbPath: string): Array<Record<string, unknown>> {
  const db = new (sqlite().DatabaseSync)(dbPath, { readOnly: true })
  try {
    return db.prepare('SELECT * FROM conversation_summaries ORDER BY conversation_id').all()
  } finally {
    db.close()
  }
}

function insertRow(end: TestEnd, values: {
  id: string
  title?: string
  workspace?: string
  stepCount?: number
  modified?: string
}): void {
  const db = new (sqlite().DatabaseSync)(end.dbPath)
  try {
    db.prepare('INSERT INTO conversation_summaries (conversation_id, title, workspace_uris, step_count, last_modified_time) VALUES (?, ?, ?, ?, ?)')
      .run(values.id, values.title ?? '', values.workspace ? JSON.stringify([values.workspace]) : '[]', values.stepCount ?? 2, values.modified ?? '2026-10-07T00:00:00Z')
  } finally {
    db.close()
  }
}

async function writeTranscript(end: TestEnd, id: string, prompt: string, step = 1, mtimeMs?: number): Promise<string> {
  const logs = join(end.brainDir, id, '.system_generated', 'logs')
  await fs.mkdir(logs, { recursive: true })
  const path = join(logs, 'transcript.jsonl')
  await fs.writeFile(path, `${JSON.stringify({
    type: 'USER_INPUT', step_index: step, status: 'DONE', created_at: '2026-10-07T00:00:00Z', content: prompt,
  })}\n`)
  if (mtimeMs !== undefined) await fs.utimes(path, new Date(mtimeMs), new Date(mtimeMs))
  return path
}

/** Create a WAL-mode trajectory database with a `steps` table holding 3 rows. */
function createTrajectoryDb(dbPath: string): void {
  const db = new (sqlite().DatabaseSync)(dbPath)
  try {
    db.exec('PRAGMA journal_mode = WAL;')
    db.exec('CREATE TABLE IF NOT EXISTS steps (id INTEGER PRIMARY KEY, payload TEXT)')
    const insert = db.prepare('INSERT INTO steps (payload) VALUES (?)')
    insert.run('step-1')
    insert.run('step-2')
    insert.run('step-3')
  } finally {
    db.close()
  }
}

function trajectoryStepCount(dbPath: string): number {
  const db = new (sqlite().DatabaseSync)(dbPath, { readOnly: true })
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM steps').get() as { n: number }
    return row.n
  } finally {
    db.close()
  }
}

async function transcriptText(end: TestEnd, id: string): Promise<string | undefined> {
  try {
    return await fs.readFile(join(end.brainDir, id, '.system_generated', 'logs', 'transcript.jsonl'), 'utf8')
  } catch {
    return undefined
  }
}

function syncOptions(desktop: TestEnd, cli: TestEnd): SessionSyncOptions {
  return {
    desktopRoot: desktop.root,
    cliRoot: cli.root,
  }
}

function stubRoots(desktop: TestEnd, cli: TestEnd): void {
  vi.stubEnv(ANTIGRAVITY_DESKTOP_ROOT_ENV, desktop.root)
  vi.stubEnv(ANTIGRAVITY_CLI_ROOT_ENV, cli.root)
}

function fakeProcess(): { child: ChildProcessWithoutNullStreams; stdout: PassThrough } {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const emitter = new EventEmitter()
  const child = Object.assign(emitter, {
    stdin, stdout, stderr,
    stdio: [stdin, stdout, stderr],
    killed: false, pid: 4242, exitCode: null, signalCode: null,
    spawnargs: [], spawnfile: 'agy', connected: false,
    kill: vi.fn(() => true), send: vi.fn(), disconnect: vi.fn(), unref: vi.fn(), ref: vi.fn(),
  }) as unknown as ChildProcessWithoutNullStreams
  return { child, stdout }
}

function logger(): SafeLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SafeLogger
}

describe('Antigravity dual-source sessions', () => {
  let desktop: TestEnd
  let cli: TestEnd

  beforeEach(async () => {
    desktop = await makeEnd('desktop')
    cli = await makeEnd('cli')
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await Promise.all([desktop.root, cli.root].map(root => fs.rm(root, { recursive: true, force: true }).catch(() => undefined)))
  })

  it('resolves two independent roots by default and one synthetic root for legacy callers', () => {
    stubRoots(desktop, cli)
    const ends = antigravityEnds()
    expect(ends.map(end => end.source)).toEqual(['desktop', 'cli'])
    expect(ends.map(end => end.brainDir)).toEqual([desktop.brainDir, cli.brainDir])
    expect(ends[0]!.dbPath).not.toBe(ends[1]!.dbPath)

    const legacy = resolveAntigravityEnds({ dbPath: join(desktop.root, 'custom.db') })
    expect(legacy).toHaveLength(1)
    expect(legacy[0]!.source).toBe('custom')
    expect(legacy[0]!.dbPath).toBe(join(desktop.root, 'custom.db'))
  })

  it('deduplicates sessions across both ends and prefers the newer source', async () => {
    stubRoots(desktop, cli)
    insertRow(desktop, { id: 'shared-session', title: 'Older desktop title', modified: '2026-01-01T00:00:00Z' })
    insertRow(cli, { id: 'shared-session', title: 'Newer CLI title', modified: '2026-02-01T00:00:00Z' })
    insertRow(desktop, { id: 'desktop-only', title: 'Desktop only', modified: '2026-01-15T00:00:00Z' })
    insertRow(cli, { id: 'cli-only', title: 'CLI only', modified: '2026-01-20T00:00:00Z' })

    const sessions = await discoverAntigravitySessions('', 30)
    expect(sessions.map(session => session.conversationId).sort()).toEqual(['cli-only', 'desktop-only', 'shared-session'])
    expect(sessions.find(session => session.conversationId === 'shared-session')).toMatchObject({
      title: 'Newer CLI title', source: 'cli',
    })
    expect(sessions.find(session => session.conversationId === 'desktop-only')?.source).toBe('desktop')
    expect(sessions.find(session => session.conversationId === 'cli-only')?.source).toBe('cli')
  })

  it('merges workspace paths from both databases', async () => {
    stubRoots(desktop, cli)
    const desktopProject = join(desktop.root, 'project-a')
    const cliProject = join(cli.root, 'project-b')
    await fs.mkdir(desktopProject)
    await fs.mkdir(cliProject)
    insertRow(desktop, { id: 'desktop-work', workspace: desktopProject.replace(/^\/private/, '') })
    insertRow(cli, { id: 'cli-work', workspace: cliProject.replace(/^\/private/, '') })

    // Use real file URLs so pathToFileURL/fileURLToPath round-trip exactly.
    const { pathToFileURL } = await import('node:url')
    const db1 = new (sqlite().DatabaseSync)(desktop.dbPath)
    const db2 = new (sqlite().DatabaseSync)(cli.dbPath)
    try {
      db1.prepare('UPDATE conversation_summaries SET workspace_uris = ?').run(JSON.stringify([pathToFileURL(desktopProject).href]))
      db2.prepare('UPDATE conversation_summaries SET workspace_uris = ?').run(JSON.stringify([pathToFileURL(cliProject).href]))
    } finally {
      db1.close(); db2.close()
    }
    const workspaces = await discoverAntigravityWorkspaces()
    expect(workspaces).toContain(desktopProject)
    expect(workspaces).toContain(cliProject)
  })

  it('loads the newest transcript by default and honors an explicit single root', async () => {
    stubRoots(desktop, cli)
    await writeTranscript(desktop, 'dual-transcript', 'Desktop prompt', 1, 1_000_000)
    await writeTranscript(cli, 'dual-transcript', 'CLI prompt', 2, 2_000_000)

    const dual = await loadTranscriptEvents('dual-transcript', 'acp:dual-transcript')
    expect(dual.find(event => event.event.type === 'user/message')?.event.data).toMatchObject({
      content: [{ type: 'text', text: 'CLI prompt' }],
    })
    const single = await loadTranscriptEvents('dual-transcript', 'acp:dual-transcript', desktop.brainDir)
    expect(single.find(event => event.event.type === 'user/message')?.event.data).toMatchObject({
      content: [{ type: 'text', text: 'Desktop prompt' }],
    })
  })

  it('copies a desktop-only session into the CLI without writing to the desktop database', async () => {
    const id = 'desktop-only-session'
    insertRow(desktop, { id, title: 'Desktop resume', modified: '2026-11-01T00:00:00Z' })
    await fs.writeFile(join(desktop.conversationsDir, `${id}.pb`), 'protobuf-fixture')
    await writeTranscript(desktop, id, 'Resume me from desktop')
    const before = await fs.readFile(desktop.dbPath)
    const sidecars = await Promise.all(['-wal', '-shm', '-journal'].map(async suffix =>
      fs.stat(`${desktop.dbPath}${suffix}`).then(() => true, () => false)))

    const result = await syncDesktopSessionForResume(id, syncOptions(desktop, cli))

    expect(result.status).toBe('synced')
    expect(rowValues(cli.dbPath)).toMatchObject([{ conversation_id: id, title: 'Desktop resume' }])
    expect(await fs.readFile(join(cli.conversationsDir, `${id}.pb`), 'utf8')).toBe('protobuf-fixture')
    expect(await transcriptText(cli, id)).toContain('Resume me from desktop')
    expect(await hasCliSession(id, syncOptions(desktop, cli))).toBe(true)

    expect(await fs.readFile(desktop.dbPath)).toEqual(before)
    expect(await Promise.all(['-wal', '-shm', '-journal'].map(async suffix =>
      fs.stat(`${desktop.dbPath}${suffix}`).then(() => true, () => false)))).toEqual(sidecars)
  })

  it('exports a SQLite .db trajectory and completes a CLI session that only had summaries', async () => {
    const id = 'sqlite-trajectory-session'
    insertRow(desktop, { id, title: 'SQLite resume', modified: '2026-11-10T00:00:00Z' })
    await writeTranscript(desktop, id, 'Resume a SQLite trajectory')
    // Newer Antigravity stores the trajectory as a WAL-mode SQLite database.
    const srcDb = join(desktop.conversationsDir, `${id}.db`)
    createTrajectoryDb(srcDb)
    const desktopBefore = await fs.readFile(srcDb)

    // Simulate the broken state from the earlier patch: CLI already has the
    // brain transcript and the summaries row but its trajectory store is gone.
    insertRow(cli, { id, title: 'Stale CLI summary', modified: '2026-11-10T00:00:00Z' })
    await writeTranscript(cli, id, 'Resume a SQLite trajectory')
    expect(await hasCliSession(id, syncOptions(desktop, cli))).toBe(false)

    const result = await syncDesktopSessionForResume(id, syncOptions(desktop, cli))

    expect(result.status).toBe('synced')
    expect(result.copiedFiles.some(file => file.includes(`${id}.db`))).toBe(true)
    const cliDb = join(cli.conversationsDir, `${id}.db`)
    expect(await fs.stat(cliDb).then(() => true, () => false)).toBe(true)
    // The exported database is readable and keeps every step (including WAL-resident ones).
    expect(trajectoryStepCount(cliDb)).toBe(3)
    expect(await hasCliSession(id, syncOptions(desktop, cli))).toBe(true)
    // The live desktop database was never rewritten.
    expect(await fs.readFile(srcDb)).toEqual(desktopBefore)
  })

  it('treats a WAL-only .db as present and keeps the newest mtime', async () => {
    const id = 'wal-freshness-session'
    insertRow(desktop, { id, title: 'WAL freshness', modified: '2026-11-09T00:00:00Z' })
    const srcDb = join(desktop.conversationsDir, `${id}.db`)
    createTrajectoryDb(srcDb)
    // A newer -wal sidecar means there are uncheckpointed steps to carry over.
    const walPath = `${srcDb}-wal`
    await fs.writeFile(walPath, '')
    await fs.utimes(walPath, new Date(2_000_000_000_000), new Date(2_000_000_000_000))

    const result = await syncDesktopSessionForResume(id, syncOptions(desktop, cli))
    expect(result.status).toBe('synced')
    // Destination must not keep a stale sidecar that could corrupt the export.
    expect(await fs.stat(`${join(cli.conversationsDir, `${id}.db`)}-wal`).then(() => true, () => false)).toBe(false)
    expect(trajectoryStepCount(join(cli.conversationsDir, `${id}.db`))).toBe(3)
  })

  it('does not overwrite a newer CLI session', async () => {
    const id = 'newer-cli-session'
    insertRow(desktop, { id, title: 'Desktop old', modified: '2026-10-01T00:00:00Z' })
    await writeTranscript(desktop, id, 'Desktop version', 1, 1_000_000)
    const desktopPb = join(desktop.conversationsDir, `${id}.pb`)
    await fs.writeFile(desktopPb, 'desktop-old-pb')
    await fs.utimes(desktopPb, new Date(1_000_000), new Date(1_000_000))
    insertRow(cli, { id, title: 'CLI current', modified: '2026-11-01T00:00:00Z' })
    await writeTranscript(cli, id, 'CLI version', 2, 3_000_000)
    const cliPb = join(cli.conversationsDir, `${id}.pb`)
    await fs.writeFile(cliPb, 'cli-current-pb')
    await fs.utimes(cliPb, new Date(3_000_000), new Date(3_000_000))

    const result = await syncDesktopSessionForResume(id, syncOptions(desktop, cli))

    expect(result.status).toBe('skipped')
    expect(await transcriptText(cli, id)).toContain('CLI version')
    expect(rowValues(cli.dbPath)).toMatchObject([{ conversation_id: id, title: 'CLI current' }])
  })

  it('fails loudly on a schema mismatch and leaves the CLI database intact', async () => {
    const id = 'schema-mismatch-session'
    insertRow(desktop, { id, title: 'Desktop row', modified: '2026-11-02T00:00:00Z' })
    await writeTranscript(desktop, id, 'Schema check')
    await fs.rm(cli.dbPath)
    createDb(cli.dbPath, 'conversation_id TEXT, title TEXT, step_count INTEGER, last_modified_time TEXT')
    const before = await fs.readFile(cli.dbPath)

    await expect(syncDesktopSessionForResume(id, syncOptions(desktop, cli)))
      .rejects.toMatchObject({ code: 'SCHEMA_MISMATCH' })
    expect(await fs.readFile(cli.dbPath)).toEqual(before)
  })

  it('deduplicates identical steps while watching both brain roots', async () => {
    const id = 'watched-session'
    await writeTranscript(desktop, id, 'Step from desktop', 1, 1_000_000)
    await writeTranscript(cli, id, 'Step from desktop', 1, 2_000_000)
    const transcript = await transcriptText(cli, id)
    if (transcript === undefined) throw new Error('fixture transcript missing')
    await fs.appendFile(join(cli.brainDir, id, '.system_generated', 'logs', 'transcript.jsonl'), `${JSON.stringify({
      type: 'USER_INPUT', step_index: 2, status: 'DONE', created_at: '2026-10-07T00:00:01Z', content: 'CLI only step',
    })}\n`)

    const watcher = new TranscriptWatcher(id, undefined, { brainDirs: [desktop.brainDir, cli.brainDir] })
    const steps: number[] = []
    const messages: string[] = []
    watcher.on('step', record => steps.push(record.step_index))
    watcher.on('message', event => messages.push(event.text))
    await watcher.flush()
    watcher.stop()

    expect(steps).toEqual([1, 2])
    expect(messages).toEqual(['Step from desktop', 'CLI only step'])
  })

  it('syncs before spawning agy with --conversation on resume', async () => {
    stubRoots(desktop, cli)
    const id = 'resume-via-client'
    insertRow(desktop, { id, title: 'Desktop-only resume', modified: '2026-11-05T00:00:00Z' })
    await writeTranscript(desktop, id, 'Client resume prompt')
    const { child, stdout } = fakeProcess()
    let passedArgs: string[] = []
    const client = new AntigravityAcpClient('agy', logger(), (_bin, args) => {
      passedArgs = args
      setTimeout(() => {
        stdout.write(`${JSON.stringify({ event: 'init', conversation_id: id })}\n`)
      }, 5)
      return child
    }, { conversationId: id, sessionWorker: true })

    await client.start()
    expect(passedArgs).toContain('--conversation')
    expect(passedArgs).toContain(id)
    expect(await transcriptText(cli, id)).toContain('Client resume prompt')
    await client.close()
  })
})
