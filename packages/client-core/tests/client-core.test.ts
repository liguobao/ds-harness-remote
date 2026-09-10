import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEvent, createRpcError, createRpcResponse, encodeMessage } from '@dsh-remote/protocol'
import { BaseTransport } from '@dsh-remote/webrtc'
import {
  CodexRemoteClient,
  HarnessAlphaClient,
  RemoteClientCore,
  RemoteClientError,
  RemoteTypertGateway,
  probeRemoteHostFeatures,
} from '../src/index.js'

class LoopbackTransport extends BaseTransport {
  sent: Uint8Array[] = []
  sendGate?: Promise<void>
  closeError?: Error

  async connect() {}

  async send(data: Uint8Array) {
    this.sent.push(data)
    await this.sendGate
  }

  async close() {
    if (this.closeError !== undefined) throw this.closeError
  }

  getStats() { return { mode: 'Relay' as const, connected: true } }
  push(data: Uint8Array) { this.emit(data) }
  drop() { this.emitClose() }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('RemoteClientCore', () => {
  it('matches responses to pending RPC calls', async () => {
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport)
    await client.connect()
    const call = client.rpc('harness.api.call', {})
    const request = JSON.parse(new TextDecoder().decode(transport.sent[0]!))
    transport.push(encodeMessage(createRpcResponse(request.id, { ok: true })))
    await expect(call).resolves.toEqual({ ok: true })
  })

  it('uses TRANSPORT_CLOSED when the transport terminates a pending RPC', async () => {
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport)
    await client.connect()
    let closed = false
    client.onClose(() => { closed = true })
    const call = client.rpc('harness.api.call', {})

    transport.drop()

    await expect(call).rejects.toMatchObject({
      name: 'RemoteClientError',
      code: 'TRANSPORT_CLOSED',
    })
    expect(closed).toBe(true)
  })

  it('uses CLIENT_CLOSED when close terminates a pending RPC', async () => {
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport)
    await client.connect()
    const call = client.rpc('harness.api.call', {})

    await client.close()

    await expect(call).rejects.toMatchObject({
      name: 'RemoteClientError',
      code: 'CLIENT_CLOSED',
    })
  })

  it('rejects pending RPCs before a failing transport close completes', async () => {
    const transport = new LoopbackTransport()
    transport.closeError = new Error('transport close failed')
    const client = new RemoteClientCore(transport)
    await client.connect()
    const closed = vi.fn()
    client.onClose(closed)
    const call = client.rpc('harness.api.call', {})
    const termination = expect(call).rejects.toMatchObject({ code: 'CLIENT_CLOSED' })

    const closing = client.close()
    expect(closed).toHaveBeenCalledOnce()
    await expect(closing).rejects.toThrow('transport close failed')
    await termination
  })

  it('uses RPC_TIMEOUT when a pending RPC reaches its deadline', async () => {
    vi.useFakeTimers()
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport, 1_000)
    await client.connect()
    const call = client.rpc('harness.api.call', {})
    const termination = expect(call).rejects.toMatchObject({
      name: 'RemoteClientError',
      code: 'RPC_TIMEOUT',
    })

    await vi.advanceTimersByTimeAsync(1_000)

    await termination
  })

  it('times out even when transport.send never settles', async () => {
    vi.useFakeTimers()
    const transport = new LoopbackTransport()
    transport.sendGate = new Promise<void>(() => undefined)
    const client = new RemoteClientCore(transport, 1_000)
    await client.connect()
    const call = client.rpc('harness.api.call', {})
    const termination = expect(call).rejects.toMatchObject({ code: 'RPC_TIMEOUT' })

    await vi.advanceTimersByTimeAsync(1_000)

    await termination
  })

  it('uses RPC_ABORTED and preserves the abort reason as the cause', async () => {
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport)
    const controller = new AbortController()
    await client.connect()
    const call = client.rpc('harness.api.call', {}, controller.signal)
    const reason = new Error('cancelled by caller')

    controller.abort(reason)

    await expect(call).rejects.toMatchObject({
      name: 'RemoteClientError',
      code: 'RPC_ABORTED',
      cause: reason,
    })
  })

  it('aborts even when transport.send never settles', async () => {
    const transport = new LoopbackTransport()
    transport.sendGate = new Promise<void>(() => undefined)
    const client = new RemoteClientCore(transport)
    const controller = new AbortController()
    await client.connect()
    const call = client.rpc('harness.api.call', {}, controller.signal)

    controller.abort()

    await expect(call).rejects.toMatchObject({ code: 'RPC_ABORTED' })
  })

  it('uses RPC_ABORTED for an already-aborted signal', async () => {
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport)
    const controller = new AbortController()
    controller.abort('cancelled before dispatch')
    await client.connect()

    await expect(client.rpc('harness.api.call', {}, controller.signal)).rejects.toMatchObject({
      name: 'RemoteClientError',
      code: 'RPC_ABORTED',
      cause: 'cancelled before dispatch',
    })
    expect(transport.sent).toHaveLength(0)
  })

  it('keeps the first termination reason when send fails after transport close', async () => {
    let rejectSend!: (error: Error) => void
    const transport = new LoopbackTransport()
    transport.sendGate = new Promise<void>((_, reject) => { rejectSend = reject })
    const client = new RemoteClientCore(transport)
    await client.connect()
    const call = client.rpc('harness.api.call', {})
    const termination = expect(call).rejects.toMatchObject({ code: 'TRANSPORT_CLOSED' })

    transport.drop()
    rejectSend(new Error('socket write failed'))

    await termination
  })

  it('ignores late responses after a call has already terminated', async () => {
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport)
    const controller = new AbortController()
    await client.connect()
    const call = client.rpc('harness.api.call', {}, controller.signal)
    const request = JSON.parse(new TextDecoder().decode(transport.sent[0]!))
    controller.abort()
    await expect(call).rejects.toBeInstanceOf(RemoteClientError)

    transport.push(encodeMessage(createRpcResponse(request.id, { late: true })))
  })
})

describe('Remote Host feature probing', () => {
  it('recognizes v0.1.2 Typert Remote Gateway capabilities', async () => {
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport)
    await client.connect()
    const probing = probeRemoteHostFeatures(client)
    const request = JSON.parse(new TextDecoder().decode(transport.sent[0]!))

    transport.push(encodeMessage(createRpcResponse(request.id, {
      capabilities: ['harness.remote.v1', 'harness.remote.transfer.v1'],
    })))

    await expect(probing).resolves.toMatchObject({
      apiProxy: false,
      remoteGateway: true,
      remoteTransfer: true,
    })
  })

  it('recognizes the v0.1.5 Session V3 Typert capability', async () => {
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport)
    await client.connect()
    const probing = probeRemoteHostFeatures(client)
    const request = JSON.parse(new TextDecoder().decode(transport.sent[0]!))

    transport.push(encodeMessage(createRpcResponse(request.id, {
      capabilities: ['harness.remote.v3', 'harness.remote.transfer.v1'],
    })))

    await expect(probing).resolves.toMatchObject({
      apiProxy: false,
      remoteGateway: true,
      sessionFormat: 3,
      remoteTransfer: true,
    })
  })

  it('rejects a Host that advertises conflicting Session generations', async () => {
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport)
    await client.connect()
    const probing = probeRemoteHostFeatures(client)
    const request = JSON.parse(new TextDecoder().decode(transport.sent[0]!))

    transport.push(encodeMessage(createRpcResponse(request.id, {
      capabilities: ['harness.remote.v1', 'harness.remote.v3'],
    })))

    await expect(probing).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
  })

  it('falls back to ApiProxy for legacy Hosts without describe', async () => {
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport)
    await client.connect()
    const probing = probeRemoteHostFeatures(client, 'v0.3.17')
    const request = JSON.parse(new TextDecoder().decode(transport.sent[0]!))

    transport.push(encodeMessage(createRpcError(request.id, 'METHOD_NOT_FOUND', 'not found')))

    await expect(probing).resolves.toMatchObject({
      apiProxy: true,
      remoteGateway: false,
      commandList: true,
      fileViewer: true,
    })
  })
})

describe('RemoteTypertGateway', () => {
  it('dispatches alpha Gateway calls over harness.remote.call', async () => {
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport)
    const gateway = new RemoteTypertGateway(client)
    await client.connect()

    const call = gateway.call('session/list', { args: { _request: {} } })
    const request = JSON.parse(new TextDecoder().decode(transport.sent[0]!))
    expect(request.payload).toMatchObject({
      method: 'harness.remote.call',
      params: { endpoint: 'session/list', payload: { args: { _request: {} } } },
    })
    transport.push(encodeMessage(createRpcResponse(request.id, { ok: true, value: { items: [] } })))

    await expect(call).resolves.toEqual({ items: [] })
  })

  it('routes Remote stream frames and closes the stream on iterator return', async () => {
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport)
    const gateway = new RemoteTypertGateway(client)
    await client.connect()

    const opening = gateway.open('$events', { args: {} })
    const request = JSON.parse(new TextDecoder().decode(transport.sent[0]!))
    expect(request.payload).toMatchObject({
      method: 'harness.remote.stream.open',
      params: { endpoint: '$events', payload: { args: {} } },
    })
    const streamId = request.payload.params.streamId as string
    transport.push(encodeMessage(createRpcResponse(request.id, {})))
    const iterator = (await opening)[Symbol.asyncIterator]()

    transport.push(encodeMessage(createEvent('harness.remote.frame', {
      streamId,
      hasValue: true,
      value: { type: 'ready', clientId: 'client-1', host: { home: '/home/u' } },
    })))

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: 'ready', clientId: 'client-1', host: { home: '/home/u' } },
    })
    const closing = iterator.return?.()
    await vi.waitFor(() => {
      const close = JSON.parse(new TextDecoder().decode(transport.sent.at(-1)!))
      expect(close.payload).toMatchObject({
        method: 'harness.remote.stream.close',
        params: { streamId },
      })
    })
    const close = JSON.parse(new TextDecoder().decode(transport.sent.at(-1)!))
    expect(close.payload).toMatchObject({
      method: 'harness.remote.stream.close',
      params: { streamId },
    })
    transport.push(encodeMessage(createRpcResponse(close.id, {})))
    await closing
  })
})

describe('CodexRemoteClient', () => {
  it('cleans up subscriptions when the Host closes a CodeX stream', async () => {
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport)
    const codex = new CodexRemoteClient(client)
    const frames: unknown[] = []
    const closed: string[] = []
    await client.connect()

    const opening = codex.subscribe('thr_1', frame => frames.push(frame), undefined, reason => closed.push(reason))
    const request = JSON.parse(new TextDecoder().decode(transport.sent[0]!))
    expect(request.payload).toMatchObject({
      method: 'codex.app.stream.open',
      params: { threadId: 'thr_1' },
    })
    const streamId = request.payload.params.streamId as string
    transport.push(encodeMessage(createRpcResponse(request.id, { opened: true })))
    const stream = await opening

    transport.push(encodeMessage(createEvent('codex.app.frame', {
      streamId,
      frame: { method: 'turn/started', params: { threadId: 'thr_1' } },
    })))
    expect(frames).toEqual([{ method: 'turn/started', params: { threadId: 'thr_1' } }])

    transport.push(encodeMessage(createEvent('codex.app.stream.closed', { streamId, reason: 'failed' })))
    expect(closed).toEqual(['failed'])
    transport.push(encodeMessage(createEvent('codex.app.frame', {
      streamId,
      frame: { method: 'turn/completed', params: { threadId: 'thr_1' } },
    })))
    expect(frames).toHaveLength(1)

    await stream.close()
    expect(transport.sent).toHaveLength(1)
    await client.close()
  })
})

class ScriptedCore {
  private readonly eventHandlers = new Set<(event: unknown) => void>()
  private readonly closeHandlers = new Set<() => void>()
  readonly rpcCalls: Array<{ method: string; params?: unknown }> = []

  async rpc(method: string, params?: unknown): Promise<unknown> {
    this.rpcCalls.push({ method, params })
    if (method === 'harness.remote.call') {
      const request = params as { endpoint?: string; payload?: { args?: Record<string, unknown> } }
      if (request.endpoint === '$events/result') return { ok: true, value: undefined }
      if (request.endpoint === 'session/list') {
        return {
          ok: true,
          value: {
            items: [{
              sessionId: 'legacy-session',
              updatedAt: 1,
              running: false,
              blank: false,
              agentPreset: 'code',
              projections: {
                asOfSeq: 4,
                values: { agentPreset: 'code', other: 'code' },
              },
            }],
          },
        }
      }
      if (request.endpoint === 'commands/execute') {
        return { ok: true, value: { commandId: 'permission', result: { kind: 'success' } } }
      }
      return { ok: true, value: undefined }
    }
    return {}
  }

  onEvent(handler: (event: unknown) => void): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  emit(event: unknown): void {
    for (const handler of this.eventHandlers) handler(event)
  }

  streamIdFor(endpoint: string): string {
    const open = this.rpcCalls.find(call => call.method === 'harness.remote.stream.open'
      && (call.params as { endpoint?: string }).endpoint === endpoint)
    if (open === undefined) throw new Error(`missing stream ${endpoint}`)
    return (open.params as { streamId: string }).streamId
  }
}

describe('HarnessAlphaClient', () => {
  it('normalizes legacy code preset in session list projections', async () => {
    const core = new ScriptedCore()
    const client = new HarnessAlphaClient(core as unknown as RemoteClientCore)

    const sessions = await client.sessionList()

    expect(sessions).toEqual([expect.objectContaining({
      sessionId: 'legacy-session',
      agentPreset: 'ptc',
      projections: {
        asOfSeq: 4,
        values: { agentPreset: 'ptc', other: 'code' },
      },
    })])
  })

  it('normalizes legacy code preset in live projection frames', async () => {
    const core = new ScriptedCore()
    const frames: Array<{ rpcId: string; payload: Record<string, unknown> }> = []
    const client = new HarnessAlphaClient(core as unknown as RemoteClientCore, {}, frame => frames.push(frame))

    client.start()
    await vi.waitFor(() => expect(core.streamIdFor('session/control')).toBeTruthy())
    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId: core.streamIdFor('session/control'),
        hasValue: true,
        value: { type: 'projection', sessionId: 'legacy-session', key: 'agentPreset', value: 'code', seq: 7 },
      },
    })

    await vi.waitFor(() => {
      expect(frames).toContainEqual({
        rpcId: '',
        payload: { type: 'session/projection', sessionId: 'legacy-session', key: 'agentPreset', value: 'ptc', seq: 7 },
      })
    })
    await client.close()
  })

  it('maps alpha approval waterfalls to legacy client frames and answers through $events/result', async () => {
    const core = new ScriptedCore()
    const frames: Array<{ rpcId: string; payload: Record<string, unknown> }> = []
    const client = new HarnessAlphaClient(core as unknown as RemoteClientCore, {}, frame => frames.push(frame))

    client.start()
    await vi.waitFor(() => expect(core.streamIdFor('$events')).toBeTruthy())
    const streamId = core.streamIdFor('$events')
    core.emit({ event: 'harness.remote.frame', data: { streamId, hasValue: true, value: { type: 'ready', clientId: 'client-1', host: { home: '/home/u' } } } })
    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId,
        hasValue: true,
        value: {
          type: 'waterfall',
          event: 'approval/request',
          eventId: 'approval-1',
          agentId: 'session-1',
          request: { toolName: 'edit', reason: 'needs approval' },
        },
      },
    })

    await vi.waitFor(() => {
      expect(frames).toContainEqual({
        rpcId: 'approval-1',
        payload: {
          type: 'approval/requested',
          sessionId: 'session-1',
          approvalId: 'approval-1',
          toolName: 'edit',
          reason: 'needs approval',
        },
      })
    })

    await client.respondApproval('approval-1', 'session-1', 'approval-1', 'allowed-once')
    expect(core.rpcCalls).toContainEqual({
      method: 'harness.remote.call',
      params: {
        endpoint: '$events/result',
        payload: {
          args: {
            clientId: 'client-1',
            eventId: 'approval-1',
            outcome: { kind: 'result', value: 'allowed-once' },
          },
        },
      },
    })
    await client.close()
  })

  it('opens session/follow and expands packed text chunks for legacy history reducers', async () => {
    const core = new ScriptedCore()
    const client = new HarnessAlphaClient(core as unknown as RemoteClientCore)

    const history = client.sessionHistory('session-1')
    await vi.waitFor(() => expect(core.streamIdFor('session/follow')).toBeTruthy())
    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId: core.streamIdFor('session/follow'),
        hasValue: true,
        value: {
          type: 'snapshot',
          cursor: 9,
          records: [{
            type: 'chunks',
            event: {
              type: 'chunkrow/text-chunks',
              seq: 2,
              time: 100,
              data: { turn: 1, step: 1, index: 0, dt: [5], texts: ['hel', 'lo'] },
            },
          }],
          hasMore: false,
          projections: { asOfSeq: 9, values: {} },
        },
      },
    })

    await expect(history).resolves.toEqual({
      hasMore: false,
      events: [
        { event: { type: 'assistant/chunk', seq: 2, time: 100, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hel' } } } },
        { event: { type: 'assistant/chunk', seq: 3, time: 105, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'lo' } } } },
      ],
    })
    await client.close()
  })

  it('requests and projects v0.1.5 assistant stream frames', async () => {
    const core = new ScriptedCore()
    const frames: Array<{ rpcId: string; payload: Record<string, unknown> }> = []
    const client = new HarnessAlphaClient(
      core as unknown as RemoteClientCore,
      { sessionFormat: 3 },
      frame => frames.push(frame),
    )

    const history = client.sessionHistory('session-v3')
    await vi.waitFor(() => expect(core.streamIdFor('session/follow')).toBeTruthy())
    const streamId = core.streamIdFor('session/follow')
    const open = core.rpcCalls.find(call => call.method === 'harness.remote.stream.open'
      && (call.params as { streamId?: string }).streamId === streamId)
    expect(open?.params).toMatchObject({
      endpoint: 'session/follow',
      payload: { args: { request: { assistantStream: true } } },
    })
    core.emit({ event: 'harness.remote.frame', data: { streamId, hasValue: true, value: {
      type: 'snapshot', cursor: 4, records: [{ type: 'event', event: {
        type: 'tool/result', seq: 4, time: 100, data: {}, sourceEventSeqs: [3],
        surfaceOp: { op: 'replace', startSeq: 3, endSeq: 3 },
      } }], hasMore: false,
      projections: { asOfSeq: 4, values: {} }, assistantStream: { revision: 0 },
    } } })
    await expect(history).resolves.toEqual({ events: [{ event: {
      type: 'tool/result', seq: 4, time: 100, data: {}, sourceEventSeqs: [3],
      surfaceOp: { op: 'replace', startSeq: 3, endSeq: 3 },
    } }], hasMore: false })

    core.emit({ event: 'harness.remote.frame', data: { streamId, hasValue: true, value: {
      type: 'assistant-stream', frame: {
        type: 'start', attemptId: 'attempt-1', revision: 1, startedAfterSeq: 4, turn: 2, step: 1,
      },
    } } })
    core.emit({ event: 'harness.remote.frame', data: { streamId, hasValue: true, value: {
      type: 'assistant-stream', frame: {
        type: 'chunk', attemptId: 'attempt-1', revision: 2, index: 0, time: 123,
        chunk: { type: 'text-delta', index: 0, text: 'hello' },
      },
    } } })

    await vi.waitFor(() => expect(frames).toContainEqual({
      rpcId: '',
      payload: {
        type: 'session/event',
        sessionId: 'session-v3',
        event: {
          type: 'assistant/chunk', seq: 4.5, time: 123,
          data: { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hello' } },
        },
      },
    }))
    await client.close()
  })
})
