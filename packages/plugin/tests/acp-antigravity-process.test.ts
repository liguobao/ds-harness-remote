import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { AntigravityAcpClient } from '../src/acp/adapters/antigravity-process.js'
import { createAntigravityAcpAdapter } from '../src/acp/adapters/antigravity.js'
import { cursorBinaryCandidates } from '../src/acp/gateway.js'
import type { SafeLogger } from '../src/logging.js'

describe('AntigravityAcpClient', () => {
  it('handles stream-json init, prompt and step_updates', async () => {
    const fake = fakeProcess()
    const outbound: Array<Record<string, unknown>> = []

    fake.child.stdin.on('data', chunk => {
      for (const line of String(chunk).trim().split('\n')) {
        if (!line.trim()) continue
        const message = JSON.parse(line) as Record<string, unknown>
        outbound.push(message)
        if (message.event === 'user') {
          // Emit step updates and result
          fake.stdout.write(`${JSON.stringify({
            event: 'step_update',
            step_update: {
              conversation_id: 'conv_123',
              step_index: 0,
              state: 'ACTIVE',
              step_type: 'thought',
              text_delta: 'thinking deep thoughts',
            },
          })}\n`)

          fake.stdout.write(`${JSON.stringify({
            event: 'step_update',
            step_update: {
              conversation_id: 'conv_123',
              step_index: 1,
              state: 'ACTIVE',
              step_type: 'agent_response',
              text_delta: 'hello from antigravity',
            },
          })}\n`)

          fake.stdout.write(`${JSON.stringify({
            event: 'step_update',
            step_update: {
              conversation_id: 'conv_123',
              step_index: 2,
              state: 'ACTIVE',
              step_type: 'tool',
              tool_name: 'test_tool',
              tool_info: { name: 'test_tool', parameters: { a: 1 } },
            },
          })}\n`)

          fake.stdout.write(`${JSON.stringify({
            event: 'step_update',
            step_update: {
              conversation_id: 'conv_123',
              step_index: 2,
              state: 'DONE',
              step_type: 'tool',
              tool_name: 'test_tool',
              tool_info: { name: 'test_tool', output: 'ok' },
            },
          })}\n`)

          fake.stdout.write(`${JSON.stringify({
            event: 'result',
            result: {
              conversation_id: 'conv_123',
              status: 'SUCCESS',
              response: 'hello from antigravity',
            },
          })}\n`)
        }
      }
    })

    const client = new AntigravityAcpClient('agy-custom', logger(), (bin, args) => {
      expect(bin).toBe('agy-custom')
      expect(args).toEqual(['--input-format', 'stream-json', '--output-format', 'stream-json'])
      // Emit init event from agy
      setTimeout(() => {
        fake.stdout.write(`${JSON.stringify({
          event: 'init',
          conversation_id: 'conv_123',
          init: { cwd: '/test' },
        })}\n`)
      }, 10)
      return fake.child
    })

    const inbound = vi.fn()
    client.onInbound(inbound)

    await client.start()
    expect(client.isReady()).toBe(true)

    const initResult = await client.call('initialize', {})
    expect(initResult).toHaveProperty('agentInfo.name', 'antigravity')

    const newSession = await client.call('session/new', { cwd: '/test' })
    expect(newSession).toEqual({ sessionId: 'conv_123' })

    const promptPromise = client.call('session/prompt', {
      sessionId: 'conv_123',
      prompt: [{ type: 'text', text: 'hi' }],
    })

    const result = await promptPromise
    expect(result).toHaveProperty('stopReason', 'end_turn')
    expect(outbound[0]).toEqual({
      event: 'user',
      message: { content: 'hi' },
    })

    // Verify notifications were delivered to inbound
    expect(inbound).toHaveBeenCalledWith({
      kind: 'notification',
      method: 'session/update',
      params: {
        sessionId: 'conv_123',
        update: {
          sessionUpdate: 'agent_thought_chunk',
          text: 'thinking deep thoughts',
        },
      },
    })

    expect(inbound).toHaveBeenCalledWith({
      kind: 'notification',
      method: 'session/update',
      params: {
        sessionId: 'conv_123',
        update: {
          sessionUpdate: 'agent_message_chunk',
          text: 'hello from antigravity',
        },
      },
    })

    expect(inbound).toHaveBeenCalledWith({
      kind: 'notification',
      method: 'session/update',
      params: {
        sessionId: 'conv_123',
        update: {
          sessionUpdate: 'tool_call',
          callId: '2',
          name: 'test_tool',
          parameters: { a: 1 },
        },
      },
    })

    expect(inbound).toHaveBeenCalledWith({
      kind: 'notification',
      method: 'session/update',
      params: {
        sessionId: 'conv_123',
        update: {
          sessionUpdate: 'tool_call_update',
          callId: '2',
          output: 'ok',
        },
      },
    })

    await client.close()
    expect(client.isReady()).toBe(false)
  })

  it('cancels pending prompt cleanly', async () => {
    const fake = fakeProcess()
    const client = new AntigravityAcpClient('agy', logger(), () => {
      setTimeout(() => {
        fake.stdout.write(`${JSON.stringify({
          event: 'init',
          conversation_id: 'conv_cancel',
          init: {},
        })}\n`)
      }, 5)
      return fake.child
    })

    await client.start()
    await client.call('session/new', {})

    const promptPromise = client.call('session/prompt', {
      sessionId: 'conv_cancel',
      prompt: [{ type: 'text', text: 'cancel me' }],
    })

    const cancelResult = await client.call('session/cancel', { sessionId: 'conv_cancel' })
    expect(cancelResult).toEqual({ cancelled: true })

    const promptResult = await promptPromise
    expect(promptResult).toEqual({ stopReason: 'cancelled' })

    await client.close()
  })

  it('includes agy in binary candidates and creates adapter', () => {
    const candidates = cursorBinaryCandidates('agent')
    expect(candidates).toContain('agy')
    expect(cursorBinaryCandidates('agy')).toEqual([expect.stringContaining('agy'), 'agy'])
    expect(cursorBinaryCandidates('custom-bin')).toEqual(['custom-bin'])
    const adapter = createAntigravityAcpAdapter('agy-test', logger(), () => fakeProcess().child as any)
    expect(adapter.id).toBe('antigravity')
  })
})

function fakeProcess(): {
  child: ChildProcessWithoutNullStreams
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
} {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const emitter = new EventEmitter()
  const kill = vi.fn((signal?: NodeJS.Signals | number) => {
    Object.assign(child, { killed: true })
    emitter.emit('exit', 0, signal ?? 'SIGTERM')
    return true
  })
  const child = Object.assign(emitter, {
    stdin,
    stdout,
    stderr,
    stdio: [stdin, stdout, stderr] as [PassThrough, PassThrough, PassThrough],
    killed: false,
    pid: 1234,
    exitCode: null,
    signalCode: null,
    spawnargs: [],
    spawnfile: 'agy',
    connected: false,
    kill,
    send: vi.fn(),
    disconnect: vi.fn(),
    unref: vi.fn(),
    ref: vi.fn(),
  }) as unknown as ChildProcessWithoutNullStreams
  return { child, stdin, stdout, stderr }
}

function logger(): SafeLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as SafeLogger
}
