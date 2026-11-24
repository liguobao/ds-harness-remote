import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { ClaudeAcpClient } from '../src/acp/adapters/claude-process.js'

type Wire = Record<string, any>
function setup(handle?: (message: Wire, process: ReturnType<typeof fakeProcess>, index: number) => boolean) {
  const children: ReturnType<typeof fakeProcess>[] = []
  const client = new ClaudeAcpClient('claude-test', undefined, () => {
    const child = fakeProcess()
    const index = children.push(child) - 1
    child.stdin.on('data', chunk => {
      for (const line of String(chunk).trim().split('\n')) {
        const message = JSON.parse(line)
        child.sent.push(message)
        if (handle?.(message, child, index)) continue
        if (message.id === undefined || !message.method) continue
        child.reply(message, message.method === 'session/new' ? { sessionId: `new-${child.sent.length}` } : {})
      }
    })
    return child.child
  })
  return { client, children }
}
function fakeProcess() {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams
  const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough()
  Object.assign(child, { stdin, stdout, stderr, exitCode: null, killed: false })
  child.kill = vi.fn(() => {
    Object.assign(child, { killed: true, exitCode: 0 })
    child.emit('exit', 0, null)
    return true
  })
  return { child, stdin, stdout, sent: [] as Wire[],
    send: (message: Wire) => stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`),
    reply: (message: Wire, result: unknown) => stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`),
    update: (sessionId: string, update: Wire) => stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } })}\n`),
  }
}
const chunk = (sessionUpdate: string, text: string) => ({ sessionUpdate, content: { type: 'text', text } })
const tick = () => new Promise<void>(resolve => setImmediate(resolve))

describe('Claude isolated history and live session recovery', () => {
  it('lists upstream sessions and deduplicates initial/repeated load without replaying into live listeners', async () => {
    const { client, children } = setup((message, child) => {
      if (message.method === 'session/list') { child.reply(message, { sessions: [{ sessionId: 'saved', cwd: '/tmp' }], nextCursor: 'offset:1' }); return true }
      if (message.method === 'session/load') {
        child.update('saved', chunk('user_message_chunk', 'old'))
        queueMicrotask(() => child.reply(message, { modes: { currentModeId: 'default' } }))
        return true
      }
      return false
    })
    const inbound = vi.fn()
    client.onInbound(inbound)
    try {
      await client.start()
      await expect(client.call('session/list', {})).resolves.toMatchObject({ nextCursor: 'offset:1' })
      const params = { sessionId: 'saved', cwd: '/tmp', mcpServers: [] }
      const results = await Promise.all([client.call('session/load', params), client.call('session/load', params)])
      expect(results[0]).toEqual(results[1])
      await expect(client.call('session/load', params)).resolves.toEqual(results[0])
      expect(children[0].sent.filter(m => m.method === 'session/load')).toHaveLength(1)
      expect(inbound).not.toHaveBeenCalled()
      children[0].update('saved', chunk('agent_message_chunk', 'live'))
      expect(inbound).toHaveBeenCalledOnce()
    } finally { await client.close() }
  })

  it('reads history in a separate process during an active prompt; denies permissions and keeps cancellation a notification', async () => {
    let prompt: Wire | undefined
    const { client, children } = setup((message, child, index) => {
      if (message.method === 'session/prompt') { prompt = message; return true }
      if (message.method === 'session/load' && index === 1) {
        child.update('foreign', chunk('user_message_chunk', 'ignore'))
        child.update('saved', chunk('user_message_chunk', 'question'))
        child.update('saved', chunk('agent_thought_chunk', 'thinking'))
        child.update('saved', chunk('agent_message_chunk', 'answer'))
        child.update('saved', { sessionUpdate: 'tool_call', toolCallId: 'tool-1', title: 'Read', rawInput: { path: 'a' }, status: 'in_progress' })
        child.update('saved', { sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'result' } }] })
        child.send({ id: 'permission', method: 'session/request_permission', params: { sessionId: 'saved', options: [] } })
        return true
      }
      if (message.id === 'permission' && message.result) {
        const load = child.sent.find(m => m.method === 'session/load')!
        child.reply(load, {})
        return true
      }
      return false
    })
    const inbound = vi.fn(); client.onInbound(inbound)
    try {
      await client.start()
      await client.call('session/load', { sessionId: 'saved', cwd: '/tmp' })
      const prompting = client.call('session/prompt', { sessionId: 'saved', prompt: [] })
      await client.call('session/load', { sessionId: 'saved', cwd: '/tmp' })
      expect(children[0].sent.filter(m => m.method === 'session/load')).toHaveLength(1)
      const events = await client.history('saved', '/tmp') as any[]
      expect(children).toHaveLength(2)
      expect(events.map(e => e.event.type)).toEqual(['turn/start', 'step/start', 'user/message', 'assistant/message', 'tool/call', 'tool/result', 'step/end', 'turn/end'])
      expect(events.find(e => e.event.type === 'assistant/message').event.data.message.content).toEqual([{ type: 'reasoning', text: 'thinking' }, { type: 'text', text: 'answer' }])
      expect(children[1].sent.find(m => m.id === 'permission')?.result).toEqual({ outcome: { outcome: 'cancelled' } })
      expect(children[1].child.killed).toBe(true)
      expect(children[0].child.killed).toBe(false)
      expect(inbound).not.toHaveBeenCalled()
      await client.call('session/cancel', { sessionId: 'saved' })
      expect(children[0].sent.at(-1)).not.toHaveProperty('id')
      children[0].reply(prompt!, { stopReason: 'cancelled' })
      await prompting
    } finally { await client.close() }
  })

  it('bounds replay bytes/count and rejects mismatched sessions without returning partial history', async () => {
    for (const scenario of ['bytes', 'count', 'mismatch'] as const) {
      const { client, children } = setup((message, child, index) => {
        if (message.method !== 'session/load' || index !== 1) return false
        if (scenario === 'bytes') for (let i = 0; i < 9; i++) child.update('saved', chunk('agent_message_chunk', 'x'.repeat(1024 * 1024)))
        if (scenario === 'count') for (let i = 0; i < 10001; i++) child.update('saved', chunk('agent_message_chunk', 'x'))
        child.reply(message, scenario === 'mismatch' ? { sessionId: 'wrong' } : {})
        return true
      })
      try {
        await client.start()
        await expect(client.history('saved', '/tmp'), scenario).rejects.toMatchObject({ code: scenario === 'mismatch' ? 'ACP_INVALID_SESSION' : 'ACP_HISTORY_TOO_LARGE' })
        expect(children[1].child.killed).toBe(true)
      } finally { await client.close() }
    }
  })

  it('protects newly created sessions, bounds retained sessions, and reloads after process restart', async () => {
    const { client, children } = setup()
    try {
      await client.start()
      const created = await client.call('session/new', { cwd: '/tmp' }) as { sessionId: string }
      await expect(client.call('session/load', { sessionId: created.sessionId, cwd: '/tmp' })).resolves.toEqual(created)
      expect(children[0].sent.some(m => m.method === 'session/load')).toBe(false)
      for (let i = 0; i < 29; i++) await client.call('session/load', { sessionId: `saved-${i}`, cwd: '/tmp' })
      await expect(client.call('session/load', { sessionId: 'overflow', cwd: '/tmp' })).rejects.toMatchObject({ code: 'ACP_PROCESS_LIMIT' })
      // History has its own process/slot, even when the live retention limit is full.
      await expect(client.history('saved-0', '/tmp')).resolves.toEqual([])
      children[0].child.kill('SIGTERM')
      await client.start()
      await client.call('session/load', { sessionId: created.sessionId, cwd: '/tmp' })
      expect(children[2].sent.some(m => m.method === 'session/load')).toBe(true)
    } finally { await client.close() }
  })

  it('reserves one history slot and closes pending startup/load during shutdown', async () => {
    for (const phase of ['initialize', 'session/load'] as const) {
      const { client, children } = setup((message, _child, index) => index === 1 && message.method === phase)
      await client.start()
      const history = client.history('saved', '/tmp')
      const rejected = expect(history).rejects.toBeInstanceOf(Error)
      await tick()
      await expect(client.history('other', '/tmp')).rejects.toMatchObject({ code: 'ACP_PROCESS_LIMIT' })
      await client.close()
      await rejected
      expect(children.every(p => p.child.killed)).toBe(true)
      await expect(client.history('saved', '/tmp')).rejects.toMatchObject({ code: 'ACP_CLOSED' })
    }
  })

  it('cancels only the isolated history reader and allows a fresh history read', async () => {
    const { client, children } = setup((message, _child, index) => index === 1 && message.method === 'session/load')
    const controller = new AbortController()
    const cancellation = new Error('History cancelled')
    try {
      await client.start()
      const history = client.history('saved', '/tmp', controller.signal)
      const cancelled = expect(history).rejects.toBe(cancellation)
      await vi.waitFor(() => expect(children[1]?.sent.some(message => message.method === 'session/load')).toBe(true))
      controller.abort(cancellation)
      await cancelled
      expect(children[1]?.child.killed).toBe(true)
      expect(children[0]?.child.killed).toBe(false)
      await expect(client.history('saved', '/tmp')).resolves.toEqual([])
    } finally { await client.close() }
  })

  it('intercepts requests during session/load replay and holds a bounded tombstone after timeout (#466)', async () => {
    let pendingLoad: Wire | undefined
    const { client, children } = setup((message) => {
      if (message.method === 'session/load') {
        pendingLoad = message
        return true
      }
      return false
    })
    const inbound = vi.fn()
    client.onInbound(inbound)
    try {
      await client.start()
      // Keep another live session active on the shared process to verify isolation.
      const liveSession = await client.call('session/new', { cwd: '/tmp' }) as { sessionId: string }

      // 1) During active session/load, both replay notifications and upstream requests are intercepted.
      const firstLoadOutcome = client.call('session/load', { sessionId: 'replay-1', cwd: '/tmp' }, 30).then(
        result => ({ result, error: undefined }),
        error => ({ result: undefined, error }),
      )
      await vi.waitFor(() => expect(pendingLoad).toBeDefined())
      children[0].update('replay-1', chunk('agent_message_chunk', 'replayed'))
      children[0].send({ id: 'perm-during-load', method: 'session/request_permission', params: { sessionId: 'replay-1', options: [] } })
      children[0].send({ id: 'other-during-load', method: 'fs/read_text_file', params: { sessionId: 'replay-1' } })
      // Live session events on the same process must still pass through.
      children[0].update(liveSession.sessionId, chunk('agent_message_chunk', 'live-ok'))
      await tick()
      expect(inbound).toHaveBeenCalledTimes(1)
      expect(inbound).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'notification',
        params: expect.objectContaining({ sessionId: liveSession.sessionId }),
      }))
      expect(children[0].sent.find(m => m.id === 'perm-during-load')?.result).toEqual({ outcome: { outcome: 'cancelled' } })
      expect(children[0].sent.find(m => m.id === 'other-during-load')?.error).toMatchObject({ code: -32600 })

      // 2) When session/load times out, late replay frames & requests remain suppressed by the tombstone.
      expect((await firstLoadOutcome).error).toMatchObject({ code: 'CLAUDE_REQUEST_TIMEOUT' })
      children[0].update('replay-1', chunk('agent_message_chunk', 'late-replay-after-timeout'))
      children[0].send({ id: 'perm-after-timeout', method: 'session/request_permission', params: { sessionId: 'replay-1', options: [] } })
      await tick()
      expect(inbound).toHaveBeenCalledTimes(1)
      expect(children[0].sent.find(m => m.id === 'perm-after-timeout')?.result).toEqual({ outcome: { outcome: 'cancelled' } })

      // 3) A subsequent successful session/load lifts suppression for future live turns.
      const retryLoad = client.call('session/load', { sessionId: 'replay-1', cwd: '/tmp' })
      await vi.waitFor(() => expect(children[0].sent.filter(m => m.method === 'session/load')).toHaveLength(2))
      const secondLoadReq = children[0].sent.filter(m => m.method === 'session/load')[1]!
      children[0].reply(secondLoadReq, {})
      await retryLoad
      children[0].update('replay-1', chunk('agent_message_chunk', 'now-live'))
      await tick()
      expect(inbound).toHaveBeenCalledTimes(2)
      expect(inbound).toHaveBeenLastCalledWith(expect.objectContaining({
        kind: 'notification',
        params: expect.objectContaining({ sessionId: 'replay-1' }),
      }))
    } finally { await client.close() }
  })

  it('caches models and modes from history() without marking the session live, and clears cache on load or invalidation', async () => {
    const { client } = setup((message, child, index) => {
      if (message.method === 'session/load' && index === 1) {
        child.reply(message, {
          models: {
            currentModelId: 'gemini-3-pro',
            availableModels: [{ modelId: 'gemini-3-pro', name: 'Gemini 3 Pro' }],
          },
          modes: {
            currentModeId: 'agent',
            availableModes: [{ id: 'agent', name: 'Agent' }],
          },
        })
        return true
      }
      return false
    })
    try {
      await client.start()
      expect(client.isSessionLoaded('saved-meta')).toBe(false)
      await client.history('saved-meta', '/tmp')
      expect(client.isSessionLoaded('saved-meta')).toBe(false)
      expect(client.lastHistoryMetadata('saved-meta')).toMatchObject({
        models: { current: { model: 'gemini-3-pro' } },
        modes: { currentModeId: 'agent', availableModes: [{ id: 'agent', name: 'Agent' }] },
      })
      client.invalidateHistoryMetadata('saved-meta')
      expect(client.lastHistoryMetadata('saved-meta')).toBeUndefined()

      await client.history('saved-meta', '/tmp')
      expect(client.lastHistoryMetadata('saved-meta')).toBeDefined()
      await client.call('session/load', { sessionId: 'saved-meta', cwd: '/tmp', mcpServers: [] })
      expect(client.isSessionLoaded('saved-meta')).toBe(true)
      expect(client.lastHistoryMetadata('saved-meta')).toBeUndefined()
    } finally { await client.close() }
  })
})
