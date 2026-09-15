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
  it('answers initialize on the gateway without forwarding to Cursor', async () => {
    const acp = readyAcp()
    const gateway = new AcpRemoteGateway(
      { enabled: true, binary: 'agent' },
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
      { enabled: true, binary: 'agent' },
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
      { enabled: true, binary: 'agent' },
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
      { enabled: true, binary: 'agent' },
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
      { enabled: true, binary: 'agent' },
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
})
