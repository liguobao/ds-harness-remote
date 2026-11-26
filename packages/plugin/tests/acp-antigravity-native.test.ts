import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { AntigravityNativeAcpClient } from '../src/acp/adapters/antigravity-acp.js'
import type { SpawnCursorAcp } from '../src/acp/adapters/cursor-process.js'

interface FakeAcpHandlers {
  onLoad?: (params: Record<string, unknown>) => { result?: unknown; error?: { code: number; message: string } }
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
          const reply = handlers.onLoad?.(msg.params ?? {}) ?? { error: { code: -32002, message: 'Session not found' } }
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

describe('AntigravityNativeAcpClient session/resume and desktop transcript hydration', () => {
  const tempDirs: string[] = []
  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true })
    }
  })

  it('hydrates desktop session history via session/resume and local brain transcript without calling session/load', async () => {
    const brainRoot = mkdtempSync(join(tmpdir(), 'agy-brain-'))
    tempDirs.push(brainRoot)
    const sessionId = '4d1c7ca0-e719-4382-a8cb-6b520b788ab3'
    const logDir = join(brainRoot, sessionId, '.system_generated', 'logs')
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
    const client = new AntigravityNativeAcpClient('agy', undefined, spawn, { brainDirs: [brainRoot] })
    await client.start()
    try {
      const events = await client.history(sessionId, '/tmp') as Array<{ event?: { type?: string; data?: any } }>
      expect(seenMethods).toContain('session/resume')
      expect(seenMethods).not.toContain('session/load')
      expect(events.some(e => e.event?.type === 'user/message' && e.event.data?.content?.[0]?.text === 'hello desktop')).toBe(true)
      expect(events.some(e => e.event?.type === 'assistant/message')).toBe(true)
      const meta = client.lastHistoryMetadata(sessionId)
      expect((meta?.models as { current?: { model?: string } } | undefined)?.current?.model).toBe('gemini-4-neon-medium')
    } finally {
      await client.close()
    }
  })

  it('falls back to session/resume when session/load rejects with -32002 and no local transcript exists', async () => {
    const emptyBrain = mkdtempSync(join(tmpdir(), 'agy-empty-'))
    tempDirs.push(emptyBrain)
    const sessionId = 'f1801ec1-6cc4-4756-8572-1ac24d7e7920'
    const { spawn, seenMethods } = createFakeAcpSpawner({
      onLoad: () => ({ error: { code: -32002, message: `Session not found: ${sessionId}` } }),
    })
    const client = new AntigravityNativeAcpClient('agy', undefined, spawn, { brainDirs: [emptyBrain] })
    await client.start()
    try {
      const events = await client.history(sessionId, '/tmp')
      expect(seenMethods).toContain('session/load')
      expect(seenMethods).toContain('session/resume')
      expect(events).toEqual([])
      expect(client.lastHistoryMetadata(sessionId)?.models).toBeDefined()
    } finally {
      await client.close()
    }
  })

  it('attaches live session via session/resume and populates models, falling back to session/load when resume is rejected', async () => {
    const sessionId = '4d1c7ca0-e719-4382-a8cb-6b520b788ab3'
    const { spawn, seenMethods } = createFakeAcpSpawner({})
    const client = new AntigravityNativeAcpClient('agy', undefined, spawn, { brainDirs: [] })
    await client.start()
    try {
      await client.call('session/load', { sessionId, cwd: '/tmp', mcpServers: [] })
      expect(seenMethods).toContain('session/resume')
      expect(seenMethods).not.toContain('session/load')
      expect(client.isSessionLoaded(sessionId)).toBe(true)
      const models = await client.call('dsh/sessionModels', { sessionId }) as { current?: { model?: string } }
      expect(models.current?.model).toBe('gemini-4-neon-medium')
    } finally {
      await client.close()
    }

    const fallback = createFakeAcpSpawner({
      onResume: () => ({ error: { code: -32601, message: 'Method not found' } }),
      onLoad: params => ({
        result: {
          sessionId: params.sessionId,
          models: {
            currentModelId: 'gemini-4-neon-high',
            availableModels: [{ modelId: 'gemini-4-neon-high', name: 'Gemini 4 Neon (High)' }],
          },
        },
      }),
    })
    const fallbackClient = new AntigravityNativeAcpClient('agy', undefined, fallback.spawn, { brainDirs: [] })
    await fallbackClient.start()
    try {
      await fallbackClient.call('session/load', { sessionId, cwd: '/tmp', mcpServers: [] })
      expect(fallback.seenMethods).toContain('session/resume')
      expect(fallback.seenMethods).toContain('session/load')
      expect(fallbackClient.isSessionLoaded(sessionId)).toBe(true)
    } finally {
      await fallbackClient.close()
    }
  })
})
