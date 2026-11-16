import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { CursorAcpClient } from '../src/acp/adapters/cursor-process.js'
import { ClaudeAcpClient } from '../src/acp/adapters/claude-process.js'
import type { SafeLogger } from '../src/logging.js'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { IsolatedAcpClient } from '../src/acp/adapters/isolated-process.js'

describe('Cursor and Claude model selection', () => {
  it('routes model choices through the upstream configuration and preserves per-session ownership', async () => {
    await runScenarios((['cursor', 'claude'] as const).map(backend => ({ name: backend, run: async () => {
      const processes: Array<{ outbound: any[]; selected: Map<string, string> }> = []
      let nextSession = 0
      let rejectChange = false
      const spawn = () => {
        const fake = fakeProcess()
        const state = { outbound: [] as any[], selected: new Map<string, string>() }
        processes.push(state)
        fake.child.stdin.on('data', chunk => {
          for (const line of String(chunk).trim().split('\n')) {
            const message = JSON.parse(line)
            state.outbound.push(message)
            let result: unknown = {}
            const config = (sessionId: string) => ({ configOptions: [{ id: 'model', type: 'select', currentValue: state.selected.get(sessionId), options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }] }] })
            if (message.method === 'session/new') {
              const sessionId = `session-${++nextSession}`
              state.selected.set(sessionId, 'a')
              result = { sessionId, ...config(sessionId) }
            }
            if (message.method === 'session/set_config_option') {
              if (rejectChange) {
                fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'denied' } })}\n`)
                continue
              }
              // Cursor applies a model change to every session in its process.
              if (backend === 'cursor') for (const id of state.selected.keys()) state.selected.set(id, message.params.value)
              else state.selected.set(message.params.sessionId, message.params.value)
              result = config(message.params.sessionId)
            }
            if (message.id !== undefined) fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`)
          }
        })
        return fake.child
      }
      const client = backend === 'claude' ? new ClaudeAcpClient('claude', logger(), spawn)
        : new IsolatedAcpClient('agent', logger(), { backend: 'cursor' }, () => new CursorAcpClient('agent', logger(), spawn))
      try {
        await client.start()
        const first = await client.call('session/new', { cwd: '/tmp', mcpServers: [] }) as { sessionId: string }
        const second = await client.call('session/new', { cwd: '/tmp', mcpServers: [] }) as { sessionId: string }
        await expect(client.call('dsh/selectModel', { ...first, model: 'b' })).resolves.toMatchObject({ selected: { provider: backend, model: 'b' } })
        await expect(client.call('dsh/sessionModels', second)).resolves.toMatchObject({ current: { provider: backend, model: 'a' } })
        expect(processes.flatMap(p => p.outbound).filter(p => p.method === 'session/set_config_option')).toEqual([
          expect.objectContaining({ params: { sessionId: first.sessionId, configId: 'model', value: 'b' } }),
        ])
        const prompt = client.call('session/prompt', { ...first, prompt: [{ type: 'text', text: 'fixture' }] })
        await expect(client.call('dsh/selectModel', { ...first, model: 'a' })).rejects.toMatchObject({ code: 'PROMPT_IN_PROGRESS' })
        await prompt
        rejectChange = true
        await expect(client.call('dsh/selectModel', { ...first, model: 'a' })).rejects.toThrow()
        await expect(client.call('dsh/sessionModels', first)).resolves.toMatchObject({ current: { model: 'b' } })
        await client.call('session/load', { ...first, cwd: '/tmp', mcpServers: [] })
        expect(processes.flatMap(p => p.outbound).some(p => p.method === 'session/load')).toBe(false)
        expect(processes).toHaveLength(backend === 'cursor' ? 3 : 1)
      } finally { await client.close() }
    } })))
  })
})

describe('CursorAcpClient', () => {
  it('initializes, authenticates, and correlates JSON-RPC responses', async () => {
    const fake = fakeProcess()
    const outbound: Array<Record<string, unknown>> = []
    fake.child.stdin.on('data', chunk => {
      for (const line of String(chunk).trim().split('\n')) {
        const message = JSON.parse(line) as Record<string, unknown>
        outbound.push(message)
        if (message.method === 'initialize' || message.method === 'authenticate') {
          fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} })}\n`)
        }
      }
    })
    const client = new CursorAcpClient('agent-custom', logger(), binary => {
      expect(binary).toBe('agent-custom')
      return fake.child
    })
    const inbound = vi.fn()
    client.onInbound(inbound)

    await client.start()
    expect(outbound.map(message => message.method)).toEqual(['initialize', 'authenticate'])
    expect(outbound[1]?.params).toEqual({ methodId: 'cursor_login' })

    const pending = client.call('session/new', { cwd: '/tmp', mcpServers: [] })
    await flush()
    const request = outbound.find(message => message.method === 'session/new')!
    fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'sess_1' } })}\n`)
    await expect(pending).resolves.toEqual({ sessionId: 'sess_1' })

    fake.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 'sess_1', update: { sessionUpdate: 'agent_message_chunk' } },
    })}\n`)
    fake.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 'perm-1',
      method: 'session/request_permission',
      params: { sessionId: 'sess_1' },
    })}\n`)
    await flush()
    expect(inbound).toHaveBeenNthCalledWith(1, {
      kind: 'notification',
      method: 'session/update',
      params: { sessionId: 'sess_1', update: { sessionUpdate: 'agent_message_chunk' } },
    })
    expect(inbound).toHaveBeenNthCalledWith(2, {
      kind: 'request',
      id: 'perm-1',
      method: 'session/request_permission',
      params: { sessionId: 'sess_1' },
    })

    await client.respond('perm-1', { outcome: { outcome: 'selected', optionId: 'allow-once' } })
    expect(outbound.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 'perm-1',
      result: { outcome: { outcome: 'selected', optionId: 'allow-once' } },
    })
    await client.close()
  })
})

describe('ClaudeAcpClient startup isolation', () => {
  it('initializes with Host credentials without sending any authenticate request', async () => {
    const fake = fakeProcess()
    const methods: unknown[] = []
    fake.child.stdin.on('data', chunk => {
      const message = JSON.parse(String(chunk))
      methods.push(message.method)
      fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} })}\n`)
    })
    const client = new ClaudeAcpClient(undefined, logger(), binary => {
      expect(binary).toBe('claude-agent-acp')
      return fake.child
    })
    await client.start()
    expect(client.isReady()).toBe(true)
    expect(methods).toEqual(['initialize'])
    await client.close()
  })

  it('fails closed when initialize rejects and never sends authenticate', async () => {
    const fake = fakeProcess()
    const methods: unknown[] = []
    fake.child.stdin.on('data', chunk => {
      const message = JSON.parse(String(chunk))
      methods.push(message.method)
      fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'login required' } })}\n`)
    })
    const client = new ClaudeAcpClient(undefined, logger(), () => fake.child)
    await expect(client.start()).rejects.toMatchObject({ code: 'CLAUDE_UPSTREAM_ERROR' })
    expect(client.isReady()).toBe(false)
    await expect(client.call('session/new', {})).rejects.toMatchObject({ code: 'CLAUDE_UNAVAILABLE' })
    expect(methods).toEqual(['initialize'])
    expect(fake.kill).toHaveBeenCalledWith('SIGTERM')
    await client.close()
  })

  it('rejects a pending initialize on close and ignores its late response', async () => {
    const fake = fakeProcess()
    let initializeId: unknown
    fake.child.stdin.on('data', chunk => { initializeId = JSON.parse(String(chunk)).id })
    const client = new ClaudeAcpClient(undefined, logger(), () => fake.child)
    const starting = client.start()
    const rejection = expect(starting).rejects.toMatchObject({ code: 'CLAUDE_CLOSED' })
    await client.close()
    fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: initializeId, result: {} })}\n`)
    await rejection
    expect(client.isReady()).toBe(false)
    await expect(client.start()).rejects.toMatchObject({ code: 'CLAUDE_CLOSED' })
  })

  it('cannot become ready after close races with an already delivered initialize response', async () => {
    for (const backend of ['cursor', 'claude'] as const) {
      const fake = fakeProcess()
      const methods: unknown[] = []
      fake.child.stdin.on('data', chunk => {
        const message = JSON.parse(String(chunk))
        methods.push(message.method)
        fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} })}\n`)
      })
      const client = backend === 'cursor'
        ? new CursorAcpClient('agent', logger(), () => fake.child)
        : new ClaudeAcpClient(undefined, logger(), () => fake.child)
      const starting = client.start()
      const rejection = expect(starting).rejects.toMatchObject({ code: backend === 'cursor' ? 'CURSOR_CLOSED' : 'CLAUDE_CLOSED' })
      await client.close()
      await rejection
      expect(client.isReady(), backend).toBe(false)
      expect(methods, backend).toEqual(['initialize'])
    }
  })
})

function fakeProcess(): {
  child: ChildProcessWithoutNullStreams
  stdout: PassThrough
  kill: ReturnType<typeof vi.fn>
} {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdin = new PassThrough()
  const child = new EventEmitter() as ChildProcessWithoutNullStreams
  const kill = vi.fn(() => {
    queueMicrotask(() => child.emit('exit', 0, 'SIGTERM'))
    return true
  })
  Object.assign(child, {
    stdout,
    stderr,
    stdin,
    kill,
    exitCode: null,
    killed: false,
  })
  return { child, stdout, kill }
}

function logger(): SafeLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SafeLogger
}

async function flush(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve))
}
