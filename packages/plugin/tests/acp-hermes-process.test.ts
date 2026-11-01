import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { HermesAcpClient } from '../src/acp/adapters/hermes-process.js'

type Wire = Record<string, any>

function fakeProcess() {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams
  const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough()
  Object.assign(child, { stdin, stdout, stderr, exitCode: null, killed: false })
  child.kill = vi.fn(() => {
    Object.assign(child, { killed: true, exitCode: 0 })
    child.emit('exit', 0, null)
    return true
  })
  return {
    child, stdin, stdout, sent: [] as Wire[],
    reply: (message: Wire, result: unknown) => stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`),
    update: (sessionId: string, update: Wire) => stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } })}\n`),
  }
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve))
const chunk = (sessionUpdate: string, text: string) => ({ sessionUpdate, content: { type: 'text', text } })

function setup(handle?: (message: Wire, child: ReturnType<typeof fakeProcess>) => boolean) {
  const children: ReturnType<typeof fakeProcess>[] = []
  const spawn = vi.fn((binary: string) => {
    expect(binary).toBe('hermes')
    const child = fakeProcess()
    children.push(child)
    child.stdin.on('data', (data: Buffer) => {
      for (const line of String(data).trim().split('\n')) {
        if (!line) continue
        const message = JSON.parse(line) as Wire
        child.sent.push(message)
        if (handle?.(message, child)) continue
        if (message.id === undefined || message.method === undefined) continue
        child.reply(message, message.method === 'session/new' ? { sessionId: 'native-1' } : {})
      }
    })
    return child.child
  })
  const client = new HermesAcpClient(undefined, undefined, spawn)
  return { client, children, spawn }
}

describe('HermesAcpClient', () => {
  it('spawns `hermes acp`, exposes the Hermes model catalog and never authenticates interactively', async () => {
    const { client, children } = setup((message, child) => {
      if (message.method === 'session/new') {
        child.reply(message, {
          sessionId: 'native-1',
          modes: { currentModeId: 'default' },
          models: { currentModelId: 'magpie:deepseek', availableModels: [
            { modelId: 'magpie:deepseek', name: 'DeepSeek V4.1' },
            { modelId: 'magpie:gemini', name: 'Gemini 3.8 Flash' },
          ] },
        })
        return true
      }
      if (message.method === 'session/set_model') {
        child.reply(message, {})
        return true
      }
      return false
    })
    try {
      // The default launch must pass `acp`, otherwise `hermes` drops into its REPL.
      expect((client as unknown as { options: { args?: string[] } }).options.args).toEqual(['acp'])
      await client.start()
      const created = await client.call('session/new', { cwd: '/work/repo', mcpServers: [] })
      expect(created).toMatchObject({ sessionId: 'native-1' })
      const models = await client.call('dsh/sessionModels', { sessionId: 'native-1' }) as any
      expect(models.current).toMatchObject({ provider: 'hermes', model: 'magpie:deepseek' })
      expect(models.groups[0]).toMatchObject({ id: 'hermes', name: 'Hermes' })
      expect(models.groups[0].models.map((item: { id: string }) => item.id)).toEqual(['magpie:deepseek', 'magpie:gemini'])
      await expect(client.call('dsh/selectModel', { sessionId: 'native-1', model: 'magpie:gemini' }))
        .resolves.toMatchObject({ selected: { provider: 'hermes', model: 'magpie:gemini' } })
      expect(children[0]!.sent.filter(message => message.method === 'session/set_model')).toEqual([
        expect.objectContaining({ params: { sessionId: 'native-1', modelId: 'magpie:gemini' } }),
      ])
      // Hermes resolves credentials from the Host's own configuration; an editor login would stall it.
      expect(children[0]!.sent.some(message => message.method === 'authenticate')).toBe(false)
      expect(children[0]!.sent[0]).toMatchObject({ method: 'initialize', params: { protocolVersion: 1 } })
    } finally { await client.close() }
  })

  it('labels replayed history with the hermes provider and keeps it out of live streams', async () => {
    const { client, children } = setup((message, child) => {
      if (message.method === 'session/list') {
        child.reply(message, { sessions: [{ sessionId: 'saved-1', cwd: '/work/repo', title: 'Saved', updatedAt: '2026-11-01T12:00:00Z' }] })
        return true
      }
      if (message.method === 'session/load') {
        child.update('saved-1', chunk('user_message_chunk', 'run the tests'))
        child.update('saved-1', chunk('agent_message_chunk', 'all green'))
        queueMicrotask(() => child.reply(message, { modes: { currentModeId: 'default' } }))
        return true
      }
      return false
    })
    const live = vi.fn()
    client.onInbound(live)
    try {
      await client.start()
      const catalog = await client.call('session/list', { cwd: '/work/repo' }) as { sessions: Array<{ sessionId: string }> }
      expect(catalog.sessions.map(session => session.sessionId)).toEqual(['saved-1'])
      await client.call('session/load', { sessionId: 'saved-1', cwd: '/work/repo', mcpServers: [] })
      const history = await client.history('saved-1', '/work/repo') as Array<{ event: { type: string; data: any } }>
      const assistant = history.filter(entry => entry.event.type === 'assistant/message')
      expect(assistant).toHaveLength(1)
      expect(assistant[0]!.event.data.message.source).toMatchObject({ kind: 'model', provider: 'hermes' })
      expect(assistant[0]!.event.data.message.content).toEqual([{ type: 'text', text: 'all green' }])
      expect(history.some(entry => entry.event.type === 'user/message')).toBe(true)
      // A replayed transcript belongs to history() only, never to a live turn.
      expect(live).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'session/update' }))
      // The reader is its own process, so an in-flight turn is never interrupted.
      expect(children.length).toBe(2)
    } finally { await client.close() }
  })

  it('surfaces a missing Hermes binary instead of reporting a ready backend', async () => {
    const child = new EventEmitter() as ChildProcessWithoutNullStreams
    const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough()
    Object.assign(child, { stdin, stdout, stderr, exitCode: null, killed: false })
    child.kill = vi.fn(() => true)
    const client = new HermesAcpClient(undefined, undefined, () => {
      queueMicrotask(() => child.emit('error', new Error('spawn hermes ENOENT')))
      return child
    })
    await expect(client.start()).rejects.toMatchObject({ code: 'CURSOR_BINARY_UNAVAILABLE' })
    expect(client.isReady()).toBe(false)
  })
})

void tick
