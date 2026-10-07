import { realpath } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { AcpRemoteGateway } from '../src/acp/gateway.js'
import type { CursorAcpLike } from '../src/acp/adapters/cursor-process.js'
import type { SafeLogger } from '../src/logging.js'

function silentLogger(): SafeLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as SafeLogger
}

function readyAcp(): CursorAcpLike {
  return {
    start: vi.fn(async () => undefined),
    isReady: () => true,
    call: vi.fn(async () => ({})),
    respond: vi.fn(async () => undefined),
    respondError: vi.fn(async () => undefined),
    onInbound: () => () => undefined,
    onUnavailable: () => () => undefined,
    close: vi.fn(async () => undefined),
  }
}

describe('AcpRemoteGateway', () => {
  it('updates one backend live while preserving other backend processes and existing peers', async () => {
    const cursor = readyAcp()
    const agy = readyAcp()
    const initial = { enabled: true, backends: [
      { id: 'cursor', enabled: false, command: 'agent', args: ['acp'] },
      { id: 'antigravity', enabled: true, command: 'agy', args: [] },
    ] }
    const gateway = new AcpRemoteGateway(initial, silentLogger(), (_binary, _logger, backend) => backend.id === 'cursor' ? cursor : agy)
    await gateway.start()
    const peer = gateway.createPeer({ connectionId: 'live-peer', peerDeviceId: 'device' } as never, async () => undefined)!
    await gateway.reconfigure({ ...initial, backends: initial.backends.map(item => ({ ...item, enabled: true })) })
    expect(gateway.availableBackends().sort()).toEqual(['antigravity', 'cursor'])
    expect(agy.close).not.toHaveBeenCalled()
    await expect(peer.call({ method: 'initialize', params: { backend: 'cursor' } })).resolves.toMatchObject({ backend: 'cursor' })
    await gateway.reconfigure(initial)
    expect(cursor.close).toHaveBeenCalledTimes(1)
    expect(agy.close).not.toHaveBeenCalled()
    await expect(peer.call({ method: 'initialize', params: { backend: 'cursor' } })).rejects.toMatchObject({ code: 'CURSOR_UNAVAILABLE' })
    await expect(peer.call({ method: 'initialize', params: { backend: 'antigravity' } })).resolves.toMatchObject({ backend: 'antigravity' })
    await gateway.close()
  })

  it('stops a starting backend when disabled and rejects its late initialization', async () => {
    let finish!: () => void
    const starting = readyAcp()
    starting.start = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    starting.close = vi.fn(async () => { finish() })
    const ready = readyAcp()
    const factory = vi.fn(() => ready).mockReturnValueOnce(starting)
    const config = { enabled: true, backends: [{ id: 'cursor', enabled: true, command: '/explicit/cursor', args: ['acp'] }] }
    const gateway = new AcpRemoteGateway(config, silentLogger(), factory)
    const startup = gateway.start()
    await vi.waitFor(() => expect(starting.start).toHaveBeenCalledOnce())
    await gateway.reconfigure({ ...config, backends: config.backends.map(item => ({ ...item, enabled: false })) })
    await startup
    expect(starting.close).toHaveBeenCalled()
    expect(factory).toHaveBeenCalledOnce()
    expect(gateway.isAvailable()).toBe(false)
    expect(gateway.availableBackends()).toEqual([])
    expect(gateway.status().state).toBe('disabled')
    await gateway.reconfigure(config)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(gateway.availableBackends()).toEqual(['cursor'])
    await gateway.close()
  })

  it('honors the global switch and independent backend launch settings', async () => {
    const factory = vi.fn(() => readyAcp())
    const backends = [
      { id: 'cursor', enabled: false, command: '/custom/cursor', args: ['acp'] },
      { id: 'antigravity', enabled: true, command: '/custom/agy-wrapper', args: ['--custom'], cwd: '/tmp' },
    ]
    const disabled = new AcpRemoteGateway({ enabled: false, backends }, silentLogger(), factory)
    await disabled.start()
    expect(factory).not.toHaveBeenCalled()
    await disabled.close()
    const gateway = new AcpRemoteGateway({ enabled: true, backends }, silentLogger(), factory)
    await gateway.start()
    try {
      expect(factory).toHaveBeenCalledTimes(1)
      expect(factory).toHaveBeenCalledWith('/custom/agy-wrapper', expect.anything(), backends[1])
      expect(gateway.availableBackends()).toEqual(['antigravity'])
      await expect(gateway.call('owner', { method: 'session/load', params: { sessionId: 'cursor-old', backend: 'cursor' } }))
        .rejects.toMatchObject({ code: 'CURSOR_UNAVAILABLE' })
      await expect(gateway.call('owner', { method: 'initialize', params: { backend: 'cursor' } }))
        .rejects.toMatchObject({ code: 'CURSOR_UNAVAILABLE' })
    } finally { await gateway.close() }
  })

  it('makes a ready backend usable while another initializes and cleans up late startup on close', async () => {
    let release!: () => void
    const slow = readyAcp()
    slow.start = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
    const fast = readyAcp()
    const factory = vi.fn((_binary: string, _logger: SafeLogger, backend: { id: string }) => backend.id === 'cursor' ? slow : fast)
    const gateway = new AcpRemoteGateway({ enabled: true, backends: [
      { id: 'cursor', enabled: true, command: '/slow-cursor', args: ['acp'] },
      { id: 'antigravity', enabled: true, command: '/fast-agy', args: [] },
    ] }, silentLogger(), factory)
    const startup = gateway.start()
    const sameStartup = gateway.start()
    expect(sameStartup).toBe(startup)
    await vi.waitFor(() => expect(gateway.availableBackends()).toEqual(['antigravity']))
    expect(gateway.isAvailable()).toBe(true)
    await gateway.close()
    expect(slow.close).toHaveBeenCalled()
    release()
    await startup
    expect(gateway.status()).toMatchObject({ state: 'disabled', available: false, availableBackends: [] })
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('prewarms only a validated selected AGY directory while listing history', async () => {
    const acp = readyAcp()
    acp.prewarmSession = vi.fn()
    const gateway = new AcpRemoteGateway({ enabled: true, backends: [{ id: 'antigravity', enabled: true, command: 'agy', args: [] }, { id: 'cursor', enabled: true, command: 'agent', args: ['acp'] }] }, silentLogger(), () => acp)
    await gateway.start()
    try {
      const list = (path: string, backend = 'antigravity') => gateway.call('warm-connection', {
        method: 'dsh/sessionList', params: { path, backend },
      })
      await list(process.cwd())
      expect(acp.prewarmSession).toHaveBeenCalledWith(await realpath(process.cwd()))
      await gateway.call('warm-connection', { method: 'dsh/sessionList', params: { path: process.cwd(), backend: 'antigravity', prewarm: false } })
      expect(acp.prewarmSession).toHaveBeenCalledTimes(1)
      await list('')
      await list(process.cwd(), 'cursor')
      await expect(list('/nonexistent-agy-prewarm-directory')).rejects.toMatchObject({ code: 'CURSOR_PATH_NOT_ALLOWED' })
      expect(acp.prewarmSession).toHaveBeenCalledTimes(1)
    } finally {
      await gateway.close()
    }
  })

  it('rejects AGY images and mismatched backend labels on a Cursor-owned session', async () => {
    const acp = readyAcp()
    acp.call = vi.fn(async () => ({ sessionId: 'cursor-image-session' }))
    const gateway = new AcpRemoteGateway({ enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'agent', args: ['acp'] }] }, silentLogger(), () => acp)
    await gateway.start()
    try {
      await gateway.call('owner', { method: 'session/new', params: { cwd: process.cwd(), backend: 'cursor' } })
      const prompt = [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=' }]
      await expect(gateway.call('owner', { method: 'session/prompt', params: { sessionId: 'cursor-image-session', backend: 'cursor', prompt } })).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
      await expect(gateway.call('owner', { method: 'session/prompt', params: { sessionId: 'cursor-image-session', backend: 'antigravity', prompt } })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
      await expect(gateway.call('owner', { method: 'dsh/sessionHistory', params: { sessionId: 'acp:cursor-image-session', backend: 'antigravity' } })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
      await expect(gateway.call('owner', { method: 'dsh/sessionHistory', params: { sessionId: 'acp:cursor-image-session', backend: 'cursor' } })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
      expect(await gateway.call('owner', { method: 'dsh/sessionHistory', params: { sessionId: 'cursor:cursor-image-session', backend: 'cursor' } })).toEqual({ events: [] })
      expect(acp.call).toHaveBeenCalledTimes(1)
    } finally { await gateway.close() }
  })

  it('answers initialize on the gateway without forwarding to Cursor', async () => {
    const acp = readyAcp()
    const gateway = new AcpRemoteGateway(
      { enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'agent', args: ['acp'] }] },
      silentLogger(),
      () => acp,
    )
    await gateway.start()
    expect(gateway.isAvailable()).toBe(true)

    const result = await gateway.call('conn-1', {
      method: 'initialize',
      params: { protocolVersion: 1, clientInfo: { name: 'test', version: '0.0.1' } },
    })

    expect(result).toMatchObject({
      protocolVersion: 1,
      backend: 'cursor',
      agentInfo: { name: 'dsh-remote-acp' },
      capabilities: {
        loadSession: true,
        promptTypes: ['text'],
      },
    })
    expect(acp.call).not.toHaveBeenCalled()
  })

  it('keeps ACP inbound subscribed after first launch dispose', async () => {
    let subscribed = false
    let unsubscribed = false
    let inbound: ((message: {
      kind: 'notification'
      method: string
      params: unknown
    }) => void) | undefined
    const acp = readyAcp()
    acp.onInbound = handler => {
      subscribed = true
      inbound = handler as typeof inbound
      return () => { unsubscribed = true }
    }
    acp.call = vi.fn(async (method: string) => {
      if (method === 'session/new') return { sessionId: 'sess-sub' }
      return {}
    })
    const gateway = new AcpRemoteGateway(
      { enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'agent', args: ['acp'] }] },
      silentLogger(),
      () => acp,
    )
    await gateway.start()
    expect(subscribed).toBe(true)
    expect(unsubscribed).toBe(false)

    const frames: Array<{ event: string; data: unknown }> = []
    const peer = gateway.createPeer(
      { connectionId: 'conn-sub', peerDeviceId: 'client-1' },
      async (event, data) => { frames.push({ event, data }) },
    )
    await gateway.call('conn-sub', {
      method: 'session/new',
      params: { cwd: '/tmp', mcpServers: [] },
    })
    await peer!.openStream({ streamId: 'stream-sub', sessionId: 'sess-sub' })
    inbound?.({
      kind: 'notification',
      method: 'session/update',
      params: {
        sessionId: 'sess-sub',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'alive' } },
      },
    })
    await vi.waitFor(() => {
      expect(frames.some(frame => frame.event === 'agent.acp.frame')).toBe(true)
    })
    expect(unsubscribed).toBe(false)
  })

  it('accepts session/prompt immediately and finishes via stream update', async () => {
    let resolvePrompt: (value: unknown) => void = () => undefined
    const promptGate = new Promise<unknown>(resolve => { resolvePrompt = resolve })
    let inbound: ((message: {
      kind: 'notification'
      method: string
      params: unknown
    }) => void) | undefined
    const acp = readyAcp()
    acp.onInbound = handler => {
      inbound = handler as typeof inbound
      return () => undefined
    }
    acp.call = vi.fn(async (method: string) => {
      if (method === 'session/new') return { sessionId: 'sess-1' }
      if (method === 'session/prompt') return promptGate
      return {}
    })
    const gateway = new AcpRemoteGateway(
      { enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'agent', args: ['acp'] }] },
      silentLogger(),
      () => acp,
    )
    await gateway.start()
    const frames: Array<{ event: string; data: unknown }> = []
    const peer = gateway.createPeer(
      { connectionId: 'conn-1', peerDeviceId: 'client-1' },
      async (event, data) => { frames.push({ event, data }) },
    )
    expect(peer).toBeDefined()
    await gateway.call('conn-1', {
      method: 'session/new',
      params: { cwd: '/tmp', mcpServers: [] },
    })
    await peer!.openStream({ streamId: 'stream-1', sessionId: 'sess-1' })

    const accepted = await gateway.call('conn-1', {
      method: 'session/prompt',
      params: { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'hi' }] },
    })
    expect(accepted).toEqual({ accepted: true, stopReason: 'in_progress' })
    expect(acp.call).toHaveBeenCalledWith('session/prompt', expect.anything())

    inbound?.({
      kind: 'notification',
      method: 'session/update',
      params: {
        sessionId: 'sess-1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } },
      },
    })
    // Resolve the upstream prompt immediately after enqueueing the update so
    // the gateway must drain inboundChain before snapshotting catchUp.
    resolvePrompt({ stopReason: 'end_turn' })
    await vi.waitFor(() => {
      expect(frames.some(frame => {
        if (frame.event !== 'agent.acp.frame') return false
        const data = frame.data as {
          streamId?: string
          frame?: { params?: { update?: { sessionUpdate?: string; catchUp?: unknown[] } } }
        }
        return data.streamId === 'session:sess-1'
          && data.frame?.params?.update?.sessionUpdate === 'prompt_completed'
          && Array.isArray(data.frame?.params?.update?.catchUp)
          && (data.frame?.params?.update?.catchUp?.length ?? 0) >= 1
      })).toBe(true)
    })
  })

  it('fans out burst session/update notifications in order without dropping', async () => {
    let inbound: ((message: {
      kind: 'notification'
      method: string
      params: unknown
    }) => void) | undefined
    const acp = readyAcp()
    acp.onInbound = handler => {
      inbound = handler as typeof inbound
      return () => undefined
    }
    acp.call = vi.fn(async (method: string) => {
      if (method === 'session/new') return { sessionId: 'sess-burst' }
      return {}
    })
    const gateway = new AcpRemoteGateway(
      { enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'agent', args: ['acp'] }] },
      silentLogger(),
      () => acp,
    )
    await gateway.start()
    const frames: Array<{ event: string; data: unknown }> = []
    const peer = gateway.createPeer(
      { connectionId: 'conn-burst', peerDeviceId: 'client-1' },
      async (event, data) => {
        // Simulate slow secure-channel send so fanout must serialize.
        await new Promise(resolve => setTimeout(resolve, 5))
        frames.push({ event, data })
      },
    )
    expect(peer).toBeDefined()
    await gateway.call('conn-burst', {
      method: 'session/new',
      params: { cwd: '/tmp', mcpServers: [] },
    })
    await peer!.openStream({ streamId: 'stream-burst', sessionId: 'sess-burst' })

    const kinds = ['agent_thought_chunk', 'agent_message_chunk', 'agent_message_chunk']
    for (const kind of kinds) {
      inbound?.({
        kind: 'notification',
        method: 'session/update',
        params: {
          sessionId: 'sess-burst',
          update: { sessionUpdate: kind, content: { type: 'text', text: kind } },
        },
      })
    }

    await vi.waitFor(() => {
      expect(frames.filter(frame => frame.event === 'agent.acp.frame')).toHaveLength(3)
    })
    const received = frames
      .filter(frame => frame.event === 'agent.acp.frame')
      .map(frame => {
        const data = frame.data as { frame?: { params?: { update?: { sessionUpdate?: string } } } }
        return data.frame?.params?.update?.sessionUpdate
      })
    expect(received).toEqual(kinds)
  })

  it('buffers frames while peers are down and replays them on stream open', async () => {
    let inbound: ((message: {
      kind: 'notification'
      method: string
      params: unknown
    }) => void) | undefined
    const acp = readyAcp()
    acp.onInbound = handler => {
      inbound = handler as typeof inbound
      return () => undefined
    }
    acp.call = vi.fn(async (method: string) => {
      if (method === 'session/new') return { sessionId: 'sess-buffer' }
      return {}
    })
    const gateway = new AcpRemoteGateway(
      { enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'agent', args: ['acp'] }] },
      silentLogger(),
      () => acp,
    )
    await gateway.start()
    await gateway.call('conn-buffer', {
      method: 'session/new',
      params: { cwd: '/tmp', mcpServers: [] },
    })

    // Drop the peer so live publish has nowhere to go.
    gateway.dropPeer('conn-buffer')
    inbound?.({
      kind: 'notification',
      method: 'session/update',
      params: {
        sessionId: 'sess-buffer',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } },
      },
    })
    await vi.waitFor(() => {
      expect((gateway as unknown as { recentFrames: Map<string, unknown[]> }).recentFrames.get('sess-buffer')?.length).toBe(1)
    })

    const frames: Array<{ event: string; data: unknown }> = []
    const peer = gateway.createPeer(
      { connectionId: 'conn-buffer-2', peerDeviceId: 'client-1' },
      async (event, data) => { frames.push({ event, data }) },
    )
    expect(peer).toBeDefined()
    await peer!.openStream({ streamId: 'stream-buffer', sessionId: 'sess-buffer' })
    await vi.waitFor(() => {
      expect(frames.some(frame => {
        if (frame.event !== 'agent.acp.frame') return false
        const data = frame.data as { frame?: { params?: { update?: { sessionUpdate?: string } } } }
        return data.frame?.params?.update?.sessionUpdate === 'agent_message_chunk'
      })).toBe(true)
    })
  })

  it('only reports antigravity in availableBackends when cursor binary is unavailable', async () => {
    const gateway = new AcpRemoteGateway(
      { enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'agent', args: ['acp'] }, { id: 'antigravity', enabled: true, command: 'agy', args: [] }] },
      silentLogger(),
      (binary) => {
        if (binary.includes('agent') || binary === 'agent') {
          throw new Error('agent: not found')
        }
        return readyAcp()
      },
    )
    await gateway.start()
    expect(gateway.isAvailable()).toBe(true)
    expect(gateway.availableBackends()).toEqual(['antigravity'])
    expect(gateway.status().availableBackends).toEqual(['antigravity'])
    const init = await gateway.call('conn-test', {
      method: 'initialize',
      params: { protocolVersion: 1 },
    }) as { backend: string; availableBackends: string[] }
    expect(init.backend).toBe('antigravity')
    expect(init.availableBackends).toEqual(['antigravity'])
  })
})
