import { realpath } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { AcpRemoteGateway } from '../src/acp/gateway.js'
import type { CursorAcpInbound, CursorAcpInboundHandler, CursorAcpLike, CursorAcpUnavailableHandler } from '../src/acp/adapters/cursor-process.js'
import type { SafeLogger } from '../src/logging.js'

function silentLogger(): SafeLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SafeLogger
}

interface FakeAcp extends CursorAcpLike {
  emit(message: CursorAcpInbound): void
  fail(code: string, holdPending?: boolean): void
  settle(code?: string): void
}

function fakeAcp(call: (method: string, params: unknown) => unknown = () => ({}), options: { failStart?: boolean } = {}): FakeAcp {
  let inbound: CursorAcpInboundHandler | undefined
  let unavailable: CursorAcpUnavailableHandler | undefined
  let ready = true
  const pending: Array<(error: Error) => void> = []
  return {
    start: vi.fn(async () => { if (options.failStart) throw new Error('ACP_START_FAILED') }),
    isReady: () => ready,
    call: vi.fn(async (method: string, params: unknown) => {
      if (method === 'session/prompt') {
        // A real turn is in flight until the adapter exits or answers.
        return new Promise((_resolve, reject) => { pending.push(reject) })
      }
      return call(method, params)
    }),
    respond: vi.fn(async () => undefined),
    respondError: vi.fn(async () => undefined),
    onInbound: handler => { inbound = handler; return () => { inbound = undefined } },
    onUnavailable: handler => { unavailable = handler; return () => { unavailable = undefined } },
    close: vi.fn(async () => { ready = false }),
    emit: message => inbound?.(message),
    fail: (code, holdPending = false) => {
      ready = false
      unavailable?.(code)
      if (holdPending) return
      const error = new Error(code)
      for (const reject of pending.splice(0)) reject(error)
    },
    settle: (code = 'ACP_SETTLED') => {
      const error = new Error(code)
      for (const reject of pending.splice(0)) reject(error)
    },
  }
}

const sessionUpdate = (sessionId: string, text: string): CursorAcpInbound => ({
  kind: 'notification',
  method: 'session/update',
  params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } },
})

describe('ACP connection isolation', () => {
  it("delivers a session's live frames only to the connection that owns it", async () => {
    const cwd = await realpath(process.cwd())
    const adapter = fakeAcp(method => method === 'session/new' ? { sessionId: 'owned-1' } : {})
    const gateway = new AcpRemoteGateway({ enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'fixture', args: [] }] }, silentLogger(), () => adapter)
    await gateway.start()
    const ownerFrames: Array<[string, any]> = []
    const otherFrames: Array<[string, any]> = []
    const owner = gateway.createPeer({ connectionId: 'owner', peerDeviceId: 'phone' } as never, async (event, data) => { ownerFrames.push([event, data]) })!
    gateway.createPeer({ connectionId: 'other', peerDeviceId: 'tablet' } as never, async (event, data) => { otherFrames.push([event, data]) })!
    try {
      await gateway.call('owner', { method: 'session/new', params: { backend: 'cursor', cwd } })
      await owner.openStream({ streamId: 'owner-stream', sessionId: 'owned-1' })

      adapter.emit(sessionUpdate('owned-1', 'secret'))
      await vi.waitFor(() => expect(ownerFrames.some(([event, data]) => event === 'agent.acp.frame'
        && JSON.stringify(data).includes('secret'))).toBe(true))

      // The second connection never opened this session and must not observe it.
      expect(JSON.stringify(otherFrames)).not.toContain('secret')
      expect(otherFrames).toEqual([])
      // Ownership stays exclusive: the other connection cannot claim the session.
      await expect(gateway.call('other', { method: 'session/load', params: { backend: 'cursor', sessionId: 'owned-1' } }))
        .rejects.toMatchObject({ code: 'CURSOR_SESSION_OWNED' })
    } finally { await gateway.close() }
  })

  it('buffers for the next connection when the owner disconnects mid-turn', async () => {
    const cwd = await realpath(process.cwd())
    const adapter = fakeAcp(method => method === 'session/new' ? { sessionId: 'owned-2' } : {})
    const gateway = new AcpRemoteGateway({ enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'fixture', args: [] }] }, silentLogger(), () => adapter)
    await gateway.start()
    const firstFrames: Array<[string, any]> = []
    const secondFrames: Array<[string, any]> = []
    const otherFrames: Array<[string, any]> = []
    const first = gateway.createPeer({ connectionId: 'first', peerDeviceId: 'phone' } as never, async (event, data) => { firstFrames.push([event, data]) })!
    // A second connection stays attached the whole time: it must never see a
    // session it does not own, including while the owner is away.
    gateway.createPeer({ connectionId: 'other', peerDeviceId: 'tablet' } as never, async (event, data) => { otherFrames.push([event, data]) })!
    try {
      await gateway.call('first', { method: 'session/new', params: { backend: 'cursor', cwd } })
      await first.openStream({ streamId: 'first-stream', sessionId: 'owned-2' })
      adapter.emit(sessionUpdate('owned-2', 'before-drop'))
      await vi.waitFor(() => expect(JSON.stringify(firstFrames)).toContain('before-drop'))

      // The phone drops; the backend keeps producing for that session.
      gateway.dropPeer('first')
      adapter.emit(sessionUpdate('owned-2', 'while-away'))
      const second = gateway.createPeer({ connectionId: 'second', peerDeviceId: 'phone' } as never, async (event, data) => { secondFrames.push([event, data]) })!
      await second.openStream({ streamId: 'second-stream', sessionId: 'owned-2' })

      // The new connection reclaims the session and receives what it missed.
      await vi.waitFor(() => expect(JSON.stringify(secondFrames)).toContain('while-away'))
      expect(JSON.stringify(secondFrames)).not.toContain('before-drop')
      // The connected stranger was never a recipient.
      expect(otherFrames).toEqual([])
      adapter.emit(sessionUpdate('owned-2', 'after-reclaim'))
      await vi.waitFor(() => expect(JSON.stringify(secondFrames)).toContain('after-reclaim'))
    } finally { await gateway.close() }
  })

  it('replays the turn failure when the owner returns after its backend died', async () => {
    const cwd = await realpath(process.cwd())
    const cursor = fakeAcp(method => method === 'session/new' ? { sessionId: 'cursor-2' } : {})
    const opencode = fakeAcp(method => method === 'session/new' ? { sessionId: 'opencode-2' } : {})
    const config = { enabled: true, backends: [
      { id: 'cursor', enabled: true, command: 'cursor-fixture', args: [] },
      { id: 'opencode', enabled: true, command: 'opencode-fixture', args: [] },
    ] }
    const gateway = new AcpRemoteGateway(config, silentLogger(), binary => binary === 'cursor-fixture' ? cursor : opencode, [50, 50])
    await gateway.start()
    const firstFrames: Array<[string, any]> = []
    const first = gateway.createPeer({ connectionId: 'first', peerDeviceId: 'phone' } as never, async (event, data) => { firstFrames.push([event, data]) })!
    try {
      await gateway.call('first', { method: 'session/new', params: { backend: 'opencode', cwd } })
      await first.openStream({ streamId: 'first-stream', sessionId: 'opencode-2' })
      await gateway.call('first', { method: 'session/prompt', params: { backend: 'opencode', sessionId: 'opencode-2', prompt: [{ type: 'text', text: 'go' }] } })
      opencode.emit(sessionUpdate('opencode-2', 'partial'))
      await vi.waitFor(() => expect(JSON.stringify(firstFrames)).toContain('partial'))

      // The phone drops, then the adapter behind the running turn exits.
      gateway.dropPeer('first')
      opencode.fail('OPENCODE_ACP_EXITED')

      const secondFrames: Array<[string, any]> = []
      const second = gateway.createPeer({ connectionId: 'second', peerDeviceId: 'phone' } as never, async (event, data) => { secondFrames.push([event, data]) })!
      await second.openStream({ streamId: 'second-stream', sessionId: 'opencode-2' })

      // The reconnecting owner still learns the turn failed, and its stream is
      // closed instead of waiting for a producer that no longer exists.
      await vi.waitFor(() => expect(JSON.stringify(secondFrames)).toContain('prompt_failed'))
      expect(JSON.stringify(secondFrames)).toContain('partial')
      expect(secondFrames).toContainEqual(['agent.acp.stream.closed', { streamId: 'second-stream', reason: 'failed' }])
      // The terminal event must arrive before the stream closes: a Client that
      // sees the close first stops listening and never learns the turn failed.
      const order = secondFrames.map(([event, data]) => event === 'agent.acp.stream.closed'
        ? 'closed'
        : JSON.stringify(data).includes('prompt_failed') ? 'prompt_failed' : 'other')
      expect(order.indexOf('prompt_failed')).toBeGreaterThan(-1)
      expect(order.indexOf('prompt_failed')).toBeLessThan(order.indexOf('closed'))
    } finally { await gateway.close() }
  })

  it('still reports the turn failure when a retry replaced the adapter first', async () => {
    const cwd = await realpath(process.cwd())
    const cursor = fakeAcp(method => method === 'session/new' ? { sessionId: 'cursor-4' } : {})
    const opencodeAdapters: FakeAcp[] = []
    const config = { enabled: true, backends: [
      { id: 'cursor', enabled: true, command: 'cursor-fixture', args: [] },
      { id: 'opencode', enabled: true, command: 'opencode-fixture', args: [] },
    ] }
    const gateway = new AcpRemoteGateway(config, silentLogger(), binary => {
      if (binary === 'cursor-fixture') return cursor
      const adapter = fakeAcp(method => method === 'session/new' ? { sessionId: 'opencode-4' } : {})
      opencodeAdapters.push(adapter)
      return adapter
    }, [10, 10])
    await gateway.start()
    const first = gateway.createPeer({ connectionId: 'first', peerDeviceId: 'phone' } as never, async () => undefined)!
    try {
      await gateway.call('first', { method: 'session/new', params: { backend: 'opencode', cwd } })
      await first.openStream({ streamId: 'first-stream', sessionId: 'opencode-4' })
      await gateway.call('first', { method: 'session/prompt', params: { backend: 'opencode', sessionId: 'opencode-4', prompt: [{ type: 'text', text: 'go' }] } })

      gateway.dropPeer('first')
      // The adapter dies but the in-flight turn settles only after its retry has
      // already installed a replacement.
      opencodeAdapters[0]!.fail('OPENCODE_ACP_EXITED', true)
      await vi.waitFor(() => expect(opencodeAdapters.length).toBeGreaterThan(1))
      await vi.waitFor(() => expect(gateway.availableBackends().sort()).toEqual(['cursor', 'opencode']))
      opencodeAdapters[0]!.settle('OPENCODE_ACP_EXITED')

      const frames: Array<[string, any]> = []
      const second = gateway.createPeer({ connectionId: 'second', peerDeviceId: 'phone' } as never, async (event, data) => { frames.push([event, data]) })!
      await second.openStream({ streamId: 'second-stream', sessionId: 'opencode-4' })

      // The Client still learns the turn failed instead of waiting forever.
      await vi.waitFor(() => expect(JSON.stringify(frames)).toContain('prompt_failed'))
    } finally { await gateway.close() }
  })

  it('stops retrying a backend once its own budget is spent', async () => {
    const cwd = await realpath(process.cwd())
    const cursor = fakeAcp(method => method === 'session/new' ? { sessionId: 'cursor-5' } : {})
    const opencodeAdapters: FakeAcp[] = []
    const config = { enabled: true, backends: [
      { id: 'cursor', enabled: true, command: 'cursor-fixture', args: [] },
      { id: 'opencode', enabled: true, command: 'opencode-fixture', args: [] },
    ] }
    const gateway = new AcpRemoteGateway(config, silentLogger(), binary => {
      if (binary === 'cursor-fixture') return cursor
      // Every replacement dies immediately, so only the budget can stop the loop.
      const adapter = fakeAcp(method => method === 'session/new' ? { sessionId: 'opencode-5' } : {})
      adapter.start = vi.fn(async () => {
        opencodeAdapters.push(adapter)
        setTimeout(() => adapter.fail('OPENCODE_ACP_EXITED'), 0)
      })
      return adapter
    }, [10, 10])
    await gateway.start()
    try {
      await vi.waitFor(() => expect(gateway.availableBackends()).toEqual(['cursor']))
      // Initial launch plus two retries, then the budget is spent. Waiting for the
      // count first keeps the assertion stable on a slow machine; the second wait
      // proves the loop really stopped instead of being caught mid-budget.
      await vi.waitFor(() => expect(opencodeAdapters.length).toBe(3))
      await new Promise(resolve => setTimeout(resolve, 150))
      expect(opencodeAdapters).toHaveLength(3)
      expect(gateway.availableBackends()).toEqual(['cursor'])
    } finally { await gateway.close() }
  })

  it('tells a connected client how the turn ended before closing its stream', async () => {
    const cwd = await realpath(process.cwd())
    const cursor = fakeAcp(method => method === 'session/new' ? { sessionId: 'cursor-6' } : {})
    const opencode = fakeAcp(method => method === 'session/new' ? { sessionId: 'opencode-6' } : {})
    const config = { enabled: true, backends: [
      { id: 'cursor', enabled: true, command: 'cursor-fixture', args: [] },
      { id: 'opencode', enabled: true, command: 'opencode-fixture', args: [] },
    ] }
    const gateway = new AcpRemoteGateway(config, silentLogger(), binary => binary === 'cursor-fixture' ? cursor : opencode, [10, 10])
    await gateway.start()
    const frames: Array<[string, any]> = []
    const peer = gateway.createPeer({ connectionId: 'owner', peerDeviceId: 'phone' } as never, async (event, data) => { frames.push([event, data]) })!
    try {
      await gateway.call('owner', { method: 'session/new', params: { backend: 'opencode', cwd } })
      await peer.openStream({ streamId: 'stream', sessionId: 'opencode-6' })
      await gateway.call('owner', { method: 'session/prompt', params: { backend: 'opencode', sessionId: 'opencode-6', prompt: [{ type: 'text', text: 'go' }] } })

      opencode.fail('OPENCODE_ACP_EXITED')
      await vi.waitFor(() => expect(JSON.stringify(frames)).toContain('prompt_failed'))
      await vi.waitFor(() => expect(frames).toContainEqual(['agent.acp.stream.closed', { streamId: 'stream', reason: 'failed' }]))

      // A live Client must not be cut off before it learns the turn failed.
      const order = frames.map(([event, data]) => event === 'agent.acp.stream.closed'
        ? 'closed'
        : JSON.stringify(data).includes('prompt_failed') ? 'prompt_failed' : 'other')
      expect(order.indexOf('prompt_failed')).toBeGreaterThan(-1)
      expect(order.indexOf('prompt_failed')).toBeLessThan(order.indexOf('closed'))
    } finally { await gateway.close() }
  })

  it('starts each backend only once when a retry and a start overlap', async () => {
    const cwd = await realpath(process.cwd())
    const cursor = fakeAcp(method => method === 'session/new' ? { sessionId: 'cursor-7' } : {})
    const created: FakeAcp[] = []
    const config = { enabled: true, backends: [
      { id: 'cursor', enabled: true, command: 'cursor-fixture', args: [] },
      { id: 'opencode', enabled: true, command: 'opencode-fixture', args: [] },
    ] }
    const gateway = new AcpRemoteGateway(config, silentLogger(), binary => {
      if (binary === 'cursor-fixture') return cursor
      const adapter = fakeAcp(method => method === 'session/new' ? { sessionId: 'opencode-7' } : {})
      // Slow startup widens the window in which a second launch could begin.
      adapter.start = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 60)) })
      created.push(adapter)
      return adapter
    }, [5, 5])
    await gateway.start()
    expect(created).toHaveLength(1)
    try {
      created[0]!.fail('OPENCODE_ACP_EXITED')
      // A reconfigure-style start and the scheduled retry now both want this backend.
      await Promise.all([gateway.start().catch(() => undefined), gateway.start().catch(() => undefined)])
      await vi.waitFor(() => expect(gateway.availableBackends().sort()).toEqual(['cursor', 'opencode']))
      expect(created.length).toBeLessThanOrEqual(2)
      await vi.waitFor(() => expect(created).toHaveLength(2))
      const count = created.length
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(created).toHaveLength(count)
    } finally { await gateway.close() }
    // No replacement may be left running after the gateway closes.
    for (const adapter of created) expect(adapter.close).toHaveBeenCalled()
  })

  it('retries only the backend that failed', async () => {
    const cwd = await realpath(process.cwd())
    const cursor = fakeAcp(method => method === 'session/new' ? { sessionId: 'cursor-3' } : {})
    const opencodeAdapters: FakeAcp[] = []
    const config = { enabled: true, backends: [
      { id: 'cursor', enabled: true, command: 'cursor-fixture', args: [] },
      { id: 'opencode', enabled: true, command: 'opencode-fixture', args: [] },
    ] }
    const gateway = new AcpRemoteGateway(config, silentLogger(), binary => {
      if (binary === 'cursor-fixture') return cursor
      const adapter = fakeAcp()
      opencodeAdapters.push(adapter)
      return adapter
    }, [20, 20])
    await gateway.start()
    expect(opencodeAdapters).toHaveLength(1)
    try {
      opencodeAdapters[0]!.fail('OPENCODE_ACP_EXITED')
      await vi.waitFor(() => expect(gateway.availableBackends()).toEqual(['cursor']))

      // The dead adapter is relaunched on its own schedule and rejoins.
      await vi.waitFor(() => expect(gateway.availableBackends().sort()).toEqual(['cursor', 'opencode']))
      expect(opencodeAdapters).toHaveLength(2)
      // The healthy adapter was never restarted.
      expect(cursor.start).toHaveBeenCalledTimes(1)
    } finally { await gateway.close() }
  })

  it('keeps other backends serving when one backend becomes unavailable', async () => {
    const cwd = await realpath(process.cwd())
    const cursor = fakeAcp(method => method === 'session/new' ? { sessionId: 'cursor-1' } : {})
    const opencode = fakeAcp(method => method === 'session/new' ? { sessionId: 'opencode-1' } : {})
    const config = { enabled: true, backends: [
      { id: 'cursor', enabled: true, command: 'cursor-fixture', args: [] },
      { id: 'opencode', enabled: true, command: 'opencode-fixture', args: [] },
    ] }
    const gateway = new AcpRemoteGateway(config, silentLogger(), binary => binary === 'cursor-fixture' ? cursor : opencode)
    await gateway.start()
    expect(gateway.availableBackends().sort()).toEqual(['cursor', 'opencode'])
    const frames: Array<[string, any]> = []
    const peer = gateway.createPeer({ connectionId: 'owner', peerDeviceId: 'phone' } as never, async (event, data) => { frames.push([event, data]) })!
    try {
      await gateway.call('owner', { method: 'session/new', params: { backend: 'cursor', cwd } })
      await gateway.call('owner', { method: 'session/new', params: { backend: 'opencode', cwd } })
      await peer.openStream({ streamId: 'cursor-stream', sessionId: 'cursor-1' })
      await peer.openStream({ streamId: 'opencode-stream', sessionId: 'opencode-1' })

      opencode.fail('OPENCODE_ACP_EXITED')
      await vi.waitFor(() => expect(frames.some(([event, data]) => event === 'agent.acp.stream.closed'
        && data.streamId === 'opencode-stream')).toBe(true))

      // The failed backend's stream closes; the healthy backend keeps its own.
      const closed = frames.filter(([event]) => event === 'agent.acp.stream.closed').map(([, data]) => data.streamId)
      expect(closed).toEqual(['opencode-stream'])
      expect(gateway.availableBackends()).toEqual(['cursor'])
      expect(gateway.isAvailable()).toBe(true)
      expect(gateway.status()).toMatchObject({ available: true, state: 'ready' })

      // The dead backend's session is refused cleanly instead of hanging.
      await expect(gateway.call('owner', { method: 'session/prompt', params: { backend: 'opencode', sessionId: 'opencode-1', prompt: [{ type: 'text', text: 'hi' }] } }))
        .rejects.toMatchObject({ code: 'CURSOR_UNAVAILABLE' })

      // Cursor sessions still stream after the unrelated failure.
      cursor.emit(sessionUpdate('cursor-1', 'still-alive'))
      await vi.waitFor(() => expect(frames.some(([event, data]) => event === 'agent.acp.frame'
        && JSON.stringify(data).includes('still-alive'))).toBe(true))
    } finally { await gateway.close() }
  })
})
