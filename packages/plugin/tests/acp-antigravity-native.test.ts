import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { AntigravityNativeAcpClient, importDesktopSessionToCli } from '../src/acp/adapters/antigravity-acp.js'
import type { SpawnCursorAcp } from '../src/acp/adapters/cursor-process.js'

const nodeRequire = createRequire(import.meta.url)

interface FakeAcpHandlers {
  onLoad?: (params: Record<string, unknown>, emit: (notification: Record<string, unknown>) => void) => { result?: unknown; error?: { code: number; message: string } }
  onResume?: (params: Record<string, unknown>) => { result?: unknown; error?: { code: number; message: string } }
}

function createFakeAcpSpawner(handlers: FakeAcpHandlers) {
  const seenMethods: string[] = []
  const spawn: SpawnCursorAcp = () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const child = new EventEmitter() as ChildProcessWithoutNullStreams
    Object.assign(child, {
      stdin,
      stdout,
      stderr,
      exitCode: null,
      killed: false,
      kill: () => {
        if (!child.killed) {
          ;(child as { killed: boolean }).killed = true
          ;(child as { exitCode: number | null }).exitCode = 0
          child.emit('exit', 0, null)
        }
        return true
      },
    })

    const emit = (notification: Record<string, unknown>) => {
      stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...notification })}\n`)
    }

    let buf = ''
    stdin.on('data', chunk => {
      buf += chunk.toString('utf8')
      let idx = buf.indexOf('\n')
      while (idx !== -1) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        idx = buf.indexOf('\n')
        if (!line) continue
        const msg = JSON.parse(line) as { id?: number | string; method?: string; params?: Record<string, unknown> }
        if (!msg.method) continue
        seenMethods.push(msg.method)
        if (msg.method === 'initialize') {
          stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: 1,
              agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {}, load: {}, list: {} } },
            },
          })}\n`)
        } else if (msg.method === 'session/load') {
          const reply = handlers.onLoad?.(msg.params ?? {}, emit) ?? { error: { code: -32002, message: 'Session not found' } }
          stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...reply })}\n`)
        } else if (msg.method === 'session/resume') {
          const reply = handlers.onResume?.(msg.params ?? {}) ?? {
            result: {
              sessionId: msg.params?.sessionId,
              models: {
                currentModelId: 'gemini-4-neon-medium',
                availableModels: [{ modelId: 'gemini-4-neon-medium', name: 'Gemini 4 Neon (Medium)' }],
              },
            },
          }
          stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, ...reply })}\n`)
        }
      }
    })
    return child
  }
  return { spawn, seenMethods }
}

describe('AntigravityNativeAcpClient desktop session import and hydration', () => {
  const tempDirs: string[] = []
  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true })
    }
  })

  it('keeps history reads read-only for unimported desktop sessions without copying db files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agy-ro-'))
    tempDirs.push(root)
    const desktopDir = join(root, 'antigravity')
    const cliDir = join(root, 'antigravity-cli')
    const sessionId = '4d1c7ca0-e719-4382-a8cb-6b520b788ab3'

    mkdirSync(join(desktopDir, 'conversations'), { recursive: true })
    writeFileSync(join(desktopDir, 'conversations', `${sessionId}.db`), 'desktop-db-placeholder')
    const logDir = join(desktopDir, 'brain', sessionId, '.system_generated', 'logs')
    mkdirSync(logDir, { recursive: true })
    writeFileSync(join(logDir, 'transcript.jsonl'), [
      JSON.stringify({
        step_index: 0,
        type: 'USER_INPUT',
        status: 'DONE',
        created_at: '2026-11-26T09:29:17Z',
        content: '<USER_REQUEST>\nhello desktop\n</USER_REQUEST>',
      }),
      JSON.stringify({
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-26T09:29:18Z',
        content: 'hello back from desktop',
      }),
    ].join('\n'))

    const { spawn, seenMethods } = createFakeAcpSpawner({
      onLoad: () => ({ error: { code: -32002, message: `Session not found: ${sessionId}` } }),
    })
    const client = new AntigravityNativeAcpClient('agy', undefined, spawn, {
      desktopAppDir: desktopDir,
      cliAppDir: cliDir,
    })
    await client.start()
    try {
      const events = await client.history(sessionId, '/tmp') as Array<{ event?: { type?: string; data?: { content?: Array<{ text?: string }> } } }>
      expect(seenMethods).toContain('session/resume')
      expect(seenMethods).not.toContain('session/load')
      expect(events.some(e => e.event?.type === 'user/message' && e.event.data?.content?.[0]?.text === 'hello desktop')).toBe(true)
      expect(events.some(e => e.event?.type === 'assistant/message')).toBe(true)
      expect(existsSync(join(cliDir, 'conversations', `${sessionId}.db`))).toBe(false)
      const meta = client.lastHistoryMetadata(sessionId)
      expect((meta?.models as { current?: { model?: string } } | undefined)?.current?.model).toBe('gemini-4-neon-medium')
    } finally {
      await client.close()
    }
  })

  it('imports a WAL-active desktop conversation snapshot into CLI store on live attach and uses native session/load', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agy-import-'))
    tempDirs.push(root)
    const desktopDir = join(root, 'antigravity')
    const cliDir = join(root, 'antigravity-cli')
    const sessionId = 'cb29e3b6-f53e-46ec-a357-8a84eb262b94'

    mkdirSync(join(desktopDir, 'conversations'), { recursive: true })
    mkdirSync(join(desktopDir, 'annotations'), { recursive: true })
    mkdirSync(join(desktopDir, 'brain', sessionId, '.system_generated', 'logs'), { recursive: true })
    writeFileSync(join(desktopDir, 'annotations', `${sessionId}.pbtxt`), 'title: "Mall Dev"\n')
    writeFileSync(join(desktopDir, 'brain', sessionId, '.system_generated', 'logs', 'transcript.jsonl'), '{}\n')

    // Pre-existing CLI brain file must not be overwritten during import.
    mkdirSync(join(cliDir, 'brain', sessionId, '.user_uploaded'), { recursive: true })
    writeFileSync(join(cliDir, 'brain', sessionId, '.user_uploaded', 'existing.txt'), 'keep-me')

    const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite')
    const desktopDbPath = join(desktopDir, 'conversations', `${sessionId}.db`)
    const writer = new DatabaseSync(desktopDbPath)
    writer.exec("PRAGMA journal_mode=WAL; CREATE TABLE steps(idx INTEGER PRIMARY KEY, body TEXT); INSERT INTO steps VALUES (1, 'desktop-turn-1');")
    writer.exec("INSERT INTO steps VALUES (2, 'uncheckpointed-wal-turn');")

    const cliDbPath = join(cliDir, 'conversations', `${sessionId}.db`)
    const { spawn, seenMethods } = createFakeAcpSpawner({
      onLoad: (params, emit) => {
        // Native session/load succeeds only once the CLI store has the imported .db.
        if (!existsSync(cliDbPath)) {
          return { error: { code: -32002, message: `Session not found: ${sessionId}` } }
        }
        emit({
          method: 'session/update',
          params: {
            sessionId: params.sessionId,
            update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'replayed from cli db' } },
          },
        })
        return {
          result: {
            sessionId: params.sessionId,
            models: {
              currentModelId: 'gemini-4-neon-high',
              availableModels: [{ modelId: 'gemini-4-neon-high', name: 'Gemini 4 Neon (High)' }],
            },
          },
        }
      },
    })

    const client = new AntigravityNativeAcpClient('agy', undefined, spawn, {
      desktopAppDir: desktopDir,
      cliAppDir: cliDir,
    })
    await client.start()
    try {
      await client.call('session/load', { sessionId, cwd: '/tmp', mcpServers: [] })
      expect(seenMethods).toContain('session/load')
      expect(seenMethods).not.toContain('session/resume')
      expect(client.isSessionLoaded(sessionId)).toBe(true)
      expect(existsSync(cliDbPath)).toBe(true)
      expect(readFileSync(join(cliDir, 'annotations', `${sessionId}.pbtxt`), 'utf8')).toContain('Mall Dev')
      expect(readFileSync(join(cliDir, 'brain', sessionId, '.user_uploaded', 'existing.txt'), 'utf8')).toBe('keep-me')

      // Verify the imported snapshot captured both committed and active-WAL rows.
      const verifyDb = new DatabaseSync(cliDbPath, { readOnly: true })
      try {
        const rows = verifyDb.prepare('SELECT idx, body FROM steps ORDER BY idx').all() as Array<{ idx: number; body: string }>
        expect(rows.map(r => r.body)).toEqual(['desktop-turn-1', 'uncheckpointed-wal-turn'])
      } finally {
        verifyDb.close()
      }

      // Subsequent history reads now use native session/load from the imported CLI .db.
      const historyEvents = await client.history(sessionId, '/tmp') as Array<{ event?: { type?: string; data?: { content?: Array<{ text?: string }> } } }>
      expect(historyEvents.some(e => e.event?.type === 'user/message' && e.event.data?.content?.[0]?.text === 'replayed from cli db')).toBe(true)
    } finally {
      writer.close()
      await client.close()
    }
  })

  it('rejects symlinked or invalid desktop session imports and never overwrites an existing CLI db', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agy-sec-'))
    tempDirs.push(root)
    const desktopDir = join(root, 'antigravity')
    const cliDir = join(root, 'antigravity-cli')
    const outsideFile = join(root, 'secret.db')
    writeFileSync(outsideFile, 'secret')
    mkdirSync(join(desktopDir, 'conversations'), { recursive: true })
    mkdirSync(join(cliDir, 'conversations'), { recursive: true })

    symlinkSync(outsideFile, join(desktopDir, 'conversations', 'symlinked-id.db'))
    expect(await importDesktopSessionToCli('symlinked-id', desktopDir, cliDir)).toBe(false)
    expect(existsSync(join(cliDir, 'conversations', 'symlinked-id.db'))).toBe(false)
    expect(await importDesktopSessionToCli('../escape', desktopDir, cliDir)).toBe(false)

    // Never overwrite an already-imported CLI db.
    const existingId = 'existing-cli-session'
    writeFileSync(join(desktopDir, 'conversations', `${existingId}.db`), 'desktop-v2')
    writeFileSync(join(cliDir, 'conversations', `${existingId}.db`), 'cli-v1')
    expect(await importDesktopSessionToCli(existingId, desktopDir, cliDir)).toBe(false)
    expect(readFileSync(join(cliDir, 'conversations', `${existingId}.db`), 'utf8')).toBe('cli-v1')
  })

  it('falls back to session/resume when session/load rejects and no local db or transcript exists', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agy-empty-'))
    tempDirs.push(root)
    const desktopDir = join(root, 'antigravity')
    const cliDir = join(root, 'antigravity-cli')
    const sessionId = 'f1801ec1-6cc4-4756-8572-1ac24d7e7920'
    const { spawn, seenMethods } = createFakeAcpSpawner({
      onLoad: () => ({ error: { code: -32002, message: `Session not found: ${sessionId}` } }),
    })
    const client = new AntigravityNativeAcpClient('agy', undefined, spawn, {
      desktopAppDir: desktopDir,
      cliAppDir: cliDir,
    })
    await client.start()
    try {
      const events = await client.history(sessionId, '/tmp')
      expect(seenMethods).toContain('session/load')
      expect(seenMethods).toContain('session/resume')
      expect(events).toEqual([])
      expect(client.lastHistoryMetadata(sessionId)?.models).toBeDefined()

      await client.call('session/load', { sessionId, cwd: '/tmp', mcpServers: [] })
      expect(client.isSessionLoaded(sessionId)).toBe(true)
    } finally {
      await client.close()
    }
  })
})
