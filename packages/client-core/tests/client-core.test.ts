import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEvent, createRpcError, createRpcResponse, encodeMessage, REMOTE_COMPACTION_CAPABILITY } from '@dsh-remote/protocol'
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
  drop(error?: Error) { this.emitClose(error) }
}

const cleanupContract1 = () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
}
afterEach(cleanupContract1)

describe('RemoteClientCore', () => {
  it('preserves terminal close reasons for recovery and notifies only once', async () => {
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport)
    await client.connect()
    const closed = vi.fn()
    client.onClose(closed)
    const error = Object.assign(new Error('replaced'), { code: 'CONNECTION_REPLACED' })
    transport.drop(error)
    await client.close()
    expect(closed).toHaveBeenCalledOnce()
    expect(closed).toHaveBeenCalledWith(error)
  })
  it('matches responses to pending RPC calls', async () => {
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport)
    await client.connect()
    const call = client.rpc('harness.api.call', {})
    const request = JSON.parse(new TextDecoder().decode(transport.sent[0]!))
    transport.push(encodeMessage(createRpcResponse(request.id, { ok: true })))
    await expect(call).resolves.toEqual({ ok: true })
  })

  it('terminates pending RPCs with the correct close reason', async () => {
    await runScenarios(
      [
        {
          name: 'uses TRANSPORT_CLOSED when the transport terminates a pending RPC',
          run: async () => {
            const transport = new LoopbackTransport()
            const client = new RemoteClientCore(transport)
            await client.connect()
            let closed = false
            client.onClose(() => {
              closed = true
            })
            const call = client.rpc('harness.api.call', {})

            transport.drop()

            await expect(call).rejects.toMatchObject({
              name: 'RemoteClientError',
              code: 'TRANSPORT_CLOSED',
            })
            expect(closed).toBe(true)
            await expect(client.rpc('harness.remote.stream.close', {})).rejects.toMatchObject({ code: 'TRANSPORT_CLOSED' })
            await client.close()
            await expect(client.rpc('harness.remote.stream.close', {})).rejects.toMatchObject({ code: 'TRANSPORT_CLOSED' })
            expect(transport.sent).toHaveLength(1)
          },
        },
        {
          name: 'uses CLIENT_CLOSED when close terminates a pending RPC',
          run: async () => {
            const transport = new LoopbackTransport()
            const client = new RemoteClientCore(transport)
            await client.connect()
            const call = client.rpc('harness.api.call', {})

            await client.close()

            await expect(call).rejects.toMatchObject({
              name: 'RemoteClientError',
              code: 'CLIENT_CLOSED',
            })
            await expect(client.rpc('harness.remote.stream.close', {})).rejects.toMatchObject({ code: 'CLIENT_CLOSED' })
            expect(transport.sent).toHaveLength(1)
          },
        },
        {
          name: 'rejects pending RPCs before a failing transport close completes',
          run: async () => {
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
          },
        },
      ],
      async () => {
        await cleanupContract1()
      },
    )
  }, 15000)

  it('enforces RPC deadlines even while send is pending', async () => {
    await runScenarios(
      [
        {
          name: 'uses RPC_TIMEOUT when a pending RPC reaches its deadline',
          run: async () => {
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
          },
        },
        {
          name: 'allows a per-call timeout longer than the client default',
          run: async () => {
            vi.useFakeTimers()
            const transport = new LoopbackTransport()
            const client = new RemoteClientCore(transport, 1_000)
            await client.connect()
            const call = client.rpc(
              'agent.acp.call',
              { method: 'session/prompt', params: {} },
              undefined,
              5_000,
            )
            const pending = expect(call).rejects.toMatchObject({ code: 'RPC_TIMEOUT' })

            await vi.advanceTimersByTimeAsync(1_000)
            await Promise.resolve()
            await vi.advanceTimersByTimeAsync(4_000)

            await pending
          },
        },
        {
          name: 'times out even when transport.send never settles',
          run: async () => {
            vi.useFakeTimers()
            const transport = new LoopbackTransport()
            transport.sendGate = new Promise<void>(() => undefined)
            const client = new RemoteClientCore(transport, 1_000)
            await client.connect()
            const call = client.rpc('harness.api.call', {})
            const termination = expect(call).rejects.toMatchObject({ code: 'RPC_TIMEOUT' })

            await vi.advanceTimersByTimeAsync(1_000)

            await termination
          },
        },
        {
          name: 'applies a per-call deadline while ordinary calls keep the client-wide one',
          run: async () => {
            vi.useFakeTimers()
            const transport = new LoopbackTransport()
            const client = new RemoteClientCore(transport, 1_000)
            await client.connect()
            const ordinary = client.rpc('harness.remote.call', {})
            const ordinaryTermination = expect(ordinary).rejects.toMatchObject({
              name: 'RemoteClientError',
              code: 'RPC_TIMEOUT',
              message: 'RPC harness.remote.call timed out after 1000ms',
            })
            const extended = client.rpc('harness.remote.call', {}, undefined, { timeoutMs: 5_000 })
            const extendedTermination = expect(extended).rejects.toMatchObject({
              name: 'RemoteClientError',
              code: 'RPC_TIMEOUT',
              message: 'RPC harness.remote.call timed out after 5000ms',
            })

            await vi.advanceTimersByTimeAsync(1_000)
            await ordinaryTermination
            await vi.advanceTimersByTimeAsync(4_000)

            await extendedTermination
          },
        },
      ],
      async () => {
        await cleanupContract1()
      },
    )
  }, 20000)

  it('aborts pending RPCs and preserves the abort reason', async () => {
    await runScenarios(
      [
        {
          name: 'uses RPC_ABORTED and preserves the abort reason as the cause',
          run: async () => {
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
          },
        },
        {
          name: 'aborts even when transport.send never settles',
          run: async () => {
            const transport = new LoopbackTransport()
            transport.sendGate = new Promise<void>(() => undefined)
            const client = new RemoteClientCore(transport)
            const controller = new AbortController()
            await client.connect()
            const call = client.rpc('harness.api.call', {}, controller.signal)

            controller.abort()

            await expect(call).rejects.toMatchObject({ code: 'RPC_ABORTED' })
          },
        },
        {
          name: 'uses RPC_ABORTED for an already-aborted signal',
          run: async () => {
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
          },
        },
      ],
      async () => {
        await cleanupContract1()
      },
    )
  }, 15000)

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
  it('negotiates compatible Typert session generations', async () => {
    await runScenarios(
      [
        {
          name: 'recognizes v0.1.2 Typert Remote Gateway capabilities',
          run: async () => {
            const transport = new LoopbackTransport()
            const client = new RemoteClientCore(transport)
            await client.connect()
            const probing = probeRemoteHostFeatures(client)
            const request = JSON.parse(new TextDecoder().decode(transport.sent[0]!))

            transport.push(
              encodeMessage(
                createRpcResponse(request.id, {
                  capabilities: ['harness.remote.v1', 'harness.remote.transfer.v1'],
                }),
              ),
            )

            await expect(probing).resolves.toMatchObject({
              apiProxy: false,
              remoteGateway: true,
              remoteTransfer: true,
            })
          },
        },
        {
          name: 'recognizes the v0.1.5 Session V3 Typert capability',
          run: async () => {
            const transport = new LoopbackTransport()
            const client = new RemoteClientCore(transport)
            await client.connect()
            const probing = probeRemoteHostFeatures(client)
            const request = JSON.parse(new TextDecoder().decode(transport.sent[0]!))

            transport.push(
              encodeMessage(
                createRpcResponse(request.id, {
                  capabilities: ['harness.remote.v3', 'harness.remote.transfer.v1'],
                }),
              ),
            )

            await expect(probing).resolves.toMatchObject({
              apiProxy: false,
              remoteGateway: true,
              sessionFormat: 3,
              remoteTransfer: true,
            })
          },
        },
        {
          name: 'rejects a Host that advertises conflicting Session generations',
          run: async () => {
            const transport = new LoopbackTransport()
            const client = new RemoteClientCore(transport)
            await client.connect()
            const probing = probeRemoteHostFeatures(client)
            const request = JSON.parse(new TextDecoder().decode(transport.sent[0]!))

            transport.push(
              encodeMessage(
                createRpcResponse(request.id, {
                  capabilities: ['harness.remote.v1', 'harness.remote.v3'],
                }),
              ),
            )

            await expect(probing).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
          },
        },
      ],
      async () => {
        await cleanupContract1()
      },
    )
  }, 15000)

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

  it('parses workspaceTypes from Host description and safely handles malformed values', async () => {
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport)
    await client.connect()
    const probing = probeRemoteHostFeatures(client)
    const request = JSON.parse(new TextDecoder().decode(transport.sent[0]!))

    transport.push(encodeMessage(createRpcResponse(request.id, {
      capabilities: ['harness.remote.v3', 'codex.appserver.v1'],
      workspaceTypes: [
        { id: 'codex', name: 'CodeX', capability: 'codex.appserver.v1', available: true },
        { id: 999 }, // malformed entry ignored
      ],
    })))

    const features = await probing
    expect(features.capabilities).toEqual(['harness.remote.v3', 'codex.appserver.v1'])
    expect(features.workspaceTypes).toEqual([
      { id: 'codex', name: 'CodeX', capability: 'codex.appserver.v1', available: true },
    ])
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

  it('restores binary workspace preview fields for the native Client API codec', async () => {
    await runScenarios(
      (['workspaceFiles/readBytes', 'officeKit/render', 'officeToPdf/render'] as const).map(endpoint => ({
        name: endpoint,
        run: async () => {
          const rpc = vi.fn(async () => ({
            ok: true,
            value: {
              absolutePath: endpoint === 'workspaceFiles/readBytes' ? '/tmp/image.png' : '/tmp/report.docx',
              version: 'v1',
              bytes: 3,
              offset: 0,
              data: 'AP8Q',
              eof: true,
            },
          }))
          const client = { rpc } as unknown as RemoteClientCore

          const result = await new RemoteTypertGateway(client).dispatch(
            endpoint,
            endpoint === 'workspaceFiles/readBytes'
              ? { args: { path: '/tmp/image.png', range: { offset: 0, length: 3 } } }
              : { args: { path: '/tmp/report.docx', priority: 'foreground' } },
          )
          expect(result).toMatchObject({ ok: true, value: { data: expect.any(Uint8Array) } })
          expect(Array.from((result as { ok: true; value: { data: Uint8Array } }).value.data)).toEqual([0, 255, 16])
        },
      })),
    )
  })

  it('keeps a transfer deadline across upload and commit and bounds the cleanup close', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const calls: Array<{ method: string; options?: unknown }> = []
    const rpc = vi.fn(async (method: string, _params: unknown, _signal?: unknown, options?: unknown) => {
      calls.push({ method, options })
      now += 1_000
      if (method === 'harness.remote.call') throw Object.assign(new Error('too large'), { code: 'RESPONSE_TOO_LARGE' })
      if (method === 'harness.remote.transfer.commit') return { kind: 'inline', response: { ok: true, value: 'converted' } }
      if (method === 'harness.remote.transfer.close') return { closed: true }
      return { accepted: true }
    })
    const client = { rpc } as unknown as RemoteClientCore

    await expect(new RemoteTypertGateway(client).call(
      'officeToPdf/render',
      { args: {} },
      undefined,
      { timeoutMs: 120_000 },
    )).resolves.toBe('converted')

    expect(calls.map(call => call.method)).toEqual([
      'harness.remote.call',
      'harness.remote.transfer.open',
      'harness.remote.transfer.chunk',
      'harness.remote.transfer.commit',
      'harness.remote.transfer.close',
    ])
    expect(calls.slice(0, 4).map(call => call.options)).toEqual([
      { timeoutMs: 120_000 },
      { timeoutMs: 30_000 },
      { timeoutMs: 30_000 },
      { timeoutMs: 118_000 },
    ])
    const cleanup = calls[4]?.options as { timeoutMs: number } | undefined
    expect(cleanup?.timeoutMs).toBeGreaterThan(0)
    expect(cleanup?.timeoutMs).toBeLessThanOrEqual(5_000)
  })

  it('enforces one transfer deadline and integer per-step timeouts', async () => {
    await runScenarios([
      { name: 'default deadline before commit', options: undefined, elapsed: 60_000, rejectedStep: 'commit' },
      { name: 'explicit deadline before upload', options: { timeoutMs: 1_000 }, elapsed: 1_000, rejectedStep: 'chunk:0' },
      { name: 'chunk cap without an overall override', options: { chunkTimeoutMs: 50 }, elapsed: 0, rejectedStep: undefined },
    ].map(({ name, options, elapsed, rejectedStep }) => ({ name, run: async () => {
      let now = 0
      vi.spyOn(performance, 'now').mockImplementation(() => now)
      const calls: Array<{ method: string; timeoutMs?: number }> = []
      const rpc = vi.fn(async (method: string, _params: unknown, _signal?: unknown, opts?: { timeoutMs?: number }) => {
        calls.push({ method, timeoutMs: opts?.timeoutMs })
        if (method === 'harness.remote.call') throw Object.assign(new Error('too large'), { code: 'RESPONSE_TOO_LARGE' })
        if (method === 'harness.remote.transfer.open') now += Math.min(elapsed, 1_000)
        if (method === 'harness.remote.transfer.chunk') now += Math.max(0, elapsed - 1_000)
        if (method === 'harness.remote.transfer.commit') return { kind: 'inline', response: { ok: true, value: 'done' } }
        return { accepted: true }
      })
      const call = new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore).call('session/list', {}, undefined, options)
      if (rejectedStep) {
        await expect(call).rejects.toMatchObject({ code: 'RPC_TIMEOUT', details: { step: rejectedStep } })
        expect(calls.some(call => call.method === `harness.remote.transfer.${rejectedStep.split(':')[0]}`)).toBe(false)
      } else {
        await expect(call).resolves.toBe('done')
        expect(calls.find(call => call.method.endsWith('.chunk'))?.timeoutMs).toBe(50)
      }
      expect(calls.at(-1)?.method).toBe('harness.remote.transfer.close')
      vi.restoreAllMocks()
    } })))

    // Exercise RemoteClientCore's real timer validation: fractional durations
    // would silently fall back to its 30s default, exceeding this deadline.
    vi.useFakeTimers()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport)
    await client.connect()
    const call = new RemoteTypertGateway(client).call('session/list', {}, undefined, { timeoutMs: 1_000 })
    const failure = expect(call).rejects.toMatchObject({ code: 'RPC_TIMEOUT' })
    const answer = (index: number, value: unknown) => {
      const request = JSON.parse(new TextDecoder().decode(transport.sent[index]!))
      transport.push(encodeMessage(createRpcResponse(request.id, value)))
    }
    const direct = JSON.parse(new TextDecoder().decode(transport.sent[0]!))
    transport.push(encodeMessage(createRpcError(direct.id, 'RESPONSE_TOO_LARGE', 'too large')))
    await vi.advanceTimersByTimeAsync(0)
    answer(1, { opened: true })
    await vi.advanceTimersByTimeAsync(0)
    answer(2, { accepted: true })
    await vi.advanceTimersByTimeAsync(0)
    now = 700.25
    const open = JSON.parse(new TextDecoder().decode(transport.sent[1]!))
    answer(3, { kind: 'chunked', transferId: open.payload.params.transferId, totalBytes: 100, totalChunks: 1 })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(299)
    const close = JSON.parse(new TextDecoder().decode(transport.sent.at(-1)!))
    expect(close.payload.method).toBe('harness.remote.transfer.close')
    answer(5, { closed: true })
    await failure
    await client.close()
  })

  it('does not replay a cancelled transferred call and releases the caller once the close is bounded', async () => {
    vi.useFakeTimers()
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport, 35_000)
    const gateway = new RemoteTypertGateway(client)
    const flush = () => vi.advanceTimersByTimeAsync(0)
    const sentMessage = (index: number) => JSON.parse(new TextDecoder().decode(transport.sent[index]!))
    await client.connect()
    const controller = new AbortController()
    const call = gateway.call('officeToPdf/render', { args: {} }, controller.signal, { timeoutMs: 120_000 })
    const termination = expect(call).rejects.toMatchObject({ code: 'RPC_ABORTED' })

    const direct = sentMessage(0)
    transport.push(encodeMessage(createRpcError(direct.id, 'RESPONSE_TOO_LARGE', 'too large')))
    await flush()
    const open = sentMessage(1)
    expect(open.payload).toMatchObject({ method: 'harness.remote.transfer.open' })
    transport.push(encodeMessage(createRpcResponse(open.id, { opened: true })))
    await flush()
    const chunk = sentMessage(2)
    expect(chunk.payload).toMatchObject({ method: 'harness.remote.transfer.chunk' })
    transport.push(encodeMessage(createRpcResponse(chunk.id, { accepted: true })))
    await flush()
    expect(sentMessage(3).payload).toMatchObject({ method: 'harness.remote.transfer.commit' })

    controller.abort()
    await flush()

    const close = JSON.parse(new TextDecoder().decode(transport.sent.at(-1)!))
    expect(close.payload).toMatchObject({
      method: 'harness.remote.transfer.close',
      params: { transferId: open.payload.params.transferId },
    })
    const calls = transport.sent.map(data => JSON.parse(new TextDecoder().decode(data)).payload.method)
    expect(calls.filter(method => method === 'harness.remote.call')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(5_000)

    await termination
  })

  it('validates bounded transfer response descriptors and lengths', async () => {
    await runScenarios(
      [
        {
          name: 'rejects an oversized transferred response before allocating it',
          run: async () => {
            const methods: string[] = []
            let transferId = ''
            const rpc = vi.fn(async (method: string, params: unknown) => {
              methods.push(method)
              if (method === 'harness.remote.call')
                throw Object.assign(new Error('too large'), { code: 'RESPONSE_TOO_LARGE' })
              if (method === 'harness.remote.transfer.open') {
                transferId = (params as { transferId: string }).transferId
                return { opened: true }
              }
              if (method === 'harness.remote.transfer.commit') {
                return { kind: 'chunked', transferId, totalBytes: 100 * 1024 * 1024, totalChunks: 200 }
              }
              return { accepted: true }
            })
            const client = { rpc } as unknown as RemoteClientCore

            await expect(
              new RemoteTypertGateway(client).call('officeToPdf/render', { args: {} }, undefined, {
                timeoutMs: 120_000,
                maxResponseBytes: 12 * 1024 * 1024,
              }),
            ).rejects.toMatchObject({
              code: 'RESPONSE_TOO_LARGE',
              details: { totalBytes: 100 * 1024 * 1024, maxResponseBytes: 12 * 1024 * 1024 },
            })
            expect(methods).not.toContain('harness.remote.transfer.read')
            expect(methods).toContain('harness.remote.transfer.close')
          },
        },
        {
          name: 'finishes a transferred response inside the requested limit',
          run: async () => {
            let transferId = ''
            const rpc = vi.fn(async (method: string, params: unknown) => {
              if (method === 'harness.remote.call')
                throw Object.assign(new Error('too large'), { code: 'RESPONSE_TOO_LARGE' })
              if (method === 'harness.remote.transfer.open') {
                transferId = (params as { transferId: string }).transferId
                return { opened: true }
              }
              if (method === 'harness.remote.transfer.commit') {
                return { kind: 'chunked', transferId, totalBytes: 11, totalChunks: 1 }
              }
              if (method === 'harness.remote.transfer.read')
                return { transferId, index: 0, data: btoa('{"ok":true}') }
              return { accepted: true }
            })
            const client = { rpc } as unknown as RemoteClientCore

            await expect(
              new RemoteTypertGateway(client).call('officeToPdf/render', { args: {} }, undefined, {
                maxResponseBytes: 1024,
              }),
            ).resolves.toBeUndefined()
          },
        },
        {
          name: 'refuses an invalid transfer response limit instead of silently uncapping it',
          run: async () => {
            const rpc = vi.fn(async (method: string) => {
              if (method === 'harness.remote.call')
                throw Object.assign(new Error('too large'), { code: 'RESPONSE_TOO_LARGE' })
              return { opened: true }
            })
            const client = { rpc } as unknown as RemoteClientCore

            for (const maxResponseBytes of [Number.POSITIVE_INFINITY, 0, -1, 1.5]) {
              await expect(
                new RemoteTypertGateway(client).call('officeToPdf/render', { args: {} }, undefined, {
                  maxResponseBytes,
                }),
              ).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
            }
            expect(rpc).toHaveBeenCalledTimes(4)
          },
        },
        {
          name: 'rejects an invalid transferred descriptor before reading it',
          run: async () => {
            let transferId = ''
            const methods: string[] = []
            const rpc = vi.fn(async (method: string, params: unknown) => {
              methods.push(method)
              if (method === 'harness.remote.call')
                throw Object.assign(new Error('too large'), { code: 'RESPONSE_TOO_LARGE' })
              if (method === 'harness.remote.transfer.open') {
                transferId = (params as { transferId: string }).transferId
                return { opened: true }
              }
              if (method === 'harness.remote.transfer.commit') {
                return { kind: 'chunked', transferId, totalBytes: 11.5, totalChunks: 1 }
              }
              return { accepted: true }
            })
            const client = { rpc } as unknown as RemoteClientCore

            await expect(
              new RemoteTypertGateway(client).call('officeToPdf/render', { args: {} }),
            ).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
            expect(methods).not.toContain('harness.remote.transfer.read')
          },
        },
        {
          name: 'fails with RPC_TIMEOUT when a chunk read times out',
          run: async () => {
            let transferId = ''
            const rpc = vi.fn(async (method: string, params: unknown) => {
              if (method === 'harness.remote.call')
                throw Object.assign(new Error('too large'), { code: 'RESPONSE_TOO_LARGE' })
              if (method === 'harness.remote.transfer.open') {
                transferId = (params as { transferId: string }).transferId
                return { opened: true }
              }
              if (method === 'harness.remote.transfer.commit') {
                return { kind: 'chunked', transferId: (params as { transferId: string }).transferId, totalBytes: 100, totalChunks: 1 }
              }
              if (method === 'harness.remote.transfer.read') {
                throw Object.assign(new Error('RPC timed out'), { code: 'RPC_TIMEOUT' })
              }
              return { accepted: true }
            })
            const client = { rpc } as unknown as RemoteClientCore

            await expect(
              new RemoteTypertGateway(client).call('officeToPdf/render', { args: {} }, undefined, {
                chunkTimeoutMs: 5_000,
              }),
            ).rejects.toMatchObject({
              code: 'RPC_TIMEOUT',
              details: expect.objectContaining({
                transferId: expect.any(String),
                index: 0,
                totalChunks: 1,
              }),
            })
          },
        },
        {
          name: 'fails with TRANSFER_FAILED when a chunk read encounters a network error',
          run: async () => {
            let transferId = ''
            const rpc = vi.fn(async (method: string, params: unknown) => {
              if (method === 'harness.remote.call')
                throw Object.assign(new Error('too large'), { code: 'RESPONSE_TOO_LARGE' })
              if (method === 'harness.remote.transfer.open') {
                transferId = (params as { transferId: string }).transferId
                return { opened: true }
              }
              if (method === 'harness.remote.transfer.commit') {
                return { kind: 'chunked', transferId: (params as { transferId: string }).transferId, totalBytes: 100, totalChunks: 1 }
              }
              if (method === 'harness.remote.transfer.read') {
                throw new Error('Connection reset by peer')
              }
              return { accepted: true }
            })
            const client = { rpc } as unknown as RemoteClientCore

            await expect(
              new RemoteTypertGateway(client).call('officeToPdf/render', { args: {} }),
            ).rejects.toMatchObject({
              code: 'TRANSFER_FAILED',
              details: expect.objectContaining({
                index: 0,
                totalChunks: 1,
              }),
            })
          },
        },
        {
          name: 'rejects invalid transfer timeout options',
          run: async () => {
            const rpc = vi.fn(async (method: string) => {
              if (method === 'harness.remote.call')
                throw Object.assign(new Error('too large'), { code: 'RESPONSE_TOO_LARGE' })
              return { opened: true }
            })
            const client = { rpc } as unknown as RemoteClientCore

            for (const field of ['timeoutMs', 'chunkTimeoutMs'] as const) {
              for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
                await expect(
                  new RemoteTypertGateway(client).call('officeToPdf/render', { args: {} }, undefined, { [field]: value }),
                ).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
              }
            }
          },
        },
      ],
      async () => {
        await cleanupContract1()
      },
    )
  }, 20000)

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

  it('preserves the original size error after a mutation without submitting a second call', async () => {
    const error = Object.assign(new Error('response too large'), { code: 'RESPONSE_TOO_LARGE' })
    const rpc = vi.fn().mockRejectedValue(error)
    const client = { rpc } as unknown as RemoteClientCore
    await expect(new RemoteTypertGateway(client).call('session/prompt', { args: {} })).rejects.toBe(error)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('applies a 3-minute default timeout to speech/transcribe with upload headroom while honoring explicit overrides', async () => {
    await runScenarios(
      [
        {
          name: 'defaults speech/transcribe direct calls to 180_000ms',
          run: async () => {
            const rpc = vi.fn(async () => ({ ok: true, value: { text: 'hello' } }))
            const client = { rpc } as unknown as RemoteClientCore
            const payload = { args: { request: { audioBase64: 'UklGRg==' } } }
            await expect(new RemoteTypertGateway(client).dispatch('speech/transcribe', payload))
              .resolves.toEqual({ ok: true, value: { text: 'hello' } })
            expect(rpc).toHaveBeenCalledWith(
              'harness.remote.call',
              { endpoint: 'speech/transcribe', payload },
              expect.any(AbortSignal),
              { timeoutMs: 180_000 },
            )
          },
        },
        {
          name: 'preserves explicit timeoutMs override and additional options on speech/transcribe',
          run: async () => {
            const rpc = vi.fn(async () => ({ ok: true, value: { text: 'hello' } }))
            const gateway = new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore)
            const payload = { args: { request: { audioBase64: 'UklGRg==' } } }
            await gateway.dispatch('speech/transcribe', payload, undefined, {
              timeoutMs: 120_000,
              maxResponseBytes: 4096,
            })
            expect(rpc).toHaveBeenLastCalledWith(
              'harness.remote.call',
              { endpoint: 'speech/transcribe', payload },
              expect.any(AbortSignal),
              { timeoutMs: 120_000, maxResponseBytes: 4096 },
            )
            await gateway.dispatch('speech/transcribe', payload, undefined, {
              maxResponseBytes: 4096,
            })
            expect(rpc).toHaveBeenLastCalledWith(
              'harness.remote.call',
              { endpoint: 'speech/transcribe', payload },
              expect.any(AbortSignal),
              { maxResponseBytes: 4096, timeoutMs: 180_000 },
            )
          },
        },
        {
          name: 'reserves chunk upload headroom on top of 180_000ms for oversized speech/transcribe transfer commit',
          run: async () => {
            let now = 0
            vi.spyOn(performance, 'now').mockImplementation(() => now)
            try {
              let totalChunks = 0
              const calls: Array<{ method: string; options?: unknown }> = []
              const rpc = vi.fn(async (method: string, params: unknown, _signal?: unknown, options?: unknown) => {
                calls.push({ method, options })
                if (method === 'harness.remote.transfer.open') {
                  totalChunks = (params as { totalChunks: number }).totalChunks
                  return { opened: true }
                }
                if (method === 'harness.remote.transfer.chunk') {
                  if ((params as { index: number }).index + 1 === totalChunks) now = 15_000
                  return { accepted: true }
                }
                if (method === 'harness.remote.transfer.commit') {
                  return { kind: 'inline', response: { ok: true, value: { text: 'long audio' } } }
                }
                if (method === 'harness.remote.transfer.close') return { closed: true }
                return { accepted: true }
              })
              const audioBase64 = 'A'.repeat(2 * 1024 * 1024 + 64)
              await expect(new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore).call(
                'speech/transcribe',
                { args: { request: { audioBase64 } } },
              )).resolves.toEqual({ text: 'long audio' })
              expect(calls.some(call => call.method === 'harness.remote.call')).toBe(false)
              expect(totalChunks).toBeGreaterThan(1)
              const expectedTransferHeadroom = Math.max(60_000, totalChunks * 2_000)
              expect(calls.find(call => call.method === 'harness.remote.transfer.commit')?.options).toEqual({
                timeoutMs: 180_000 + expectedTransferHeadroom - 15_000,
              })
            } finally {
              vi.restoreAllMocks()
            }
          },
        },
        {
          name: 'honors explicit timeoutMs override without adding transfer headroom on oversized speech/transcribe',
          run: async () => {
            vi.spyOn(performance, 'now').mockReturnValue(0)
            try {
              const calls: Array<{ method: string; options?: unknown }> = []
              const rpc = vi.fn(async (method: string, _params: unknown, _signal?: unknown, options?: unknown) => {
                calls.push({ method, options })
                if (method === 'harness.remote.transfer.commit') {
                  return { kind: 'inline', response: { ok: true, value: { text: 'long audio' } } }
                }
                if (method === 'harness.remote.transfer.close') return { closed: true }
                return { accepted: true }
              })
              const audioBase64 = 'A'.repeat(2 * 1024 * 1024 + 64)
              await expect(new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore).call(
                'speech/transcribe',
                { args: { request: { audioBase64 } } },
                undefined,
                { timeoutMs: 120_000 },
              )).resolves.toEqual({ text: 'long audio' })
              expect(calls.find(call => call.method === 'harness.remote.transfer.commit')?.options).toEqual({
                timeoutMs: 120_000,
              })
            } finally {
              vi.restoreAllMocks()
            }
          },
        },
        {
          name: 'leaves speech/prepare and speech/catalog with undefined rpc options',
          run: async () => {
            const rpc = vi.fn(async () => ({ ok: true }))
            const gateway = new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore)
            await expect(gateway.dispatch('speech/prepare', { args: { providerId: 'sensevoice' } }))
              .resolves.toEqual({ ok: true })
            expect(rpc).toHaveBeenLastCalledWith(
              'harness.remote.call',
              { endpoint: 'speech/prepare', payload: { args: { providerId: 'sensevoice' } } },
              expect.any(AbortSignal),
              undefined,
            )
            await expect(gateway.dispatch('speech/catalog', { args: {} }))
              .resolves.toEqual({ ok: true })
            expect(rpc).toHaveBeenLastCalledWith(
              'harness.remote.call',
              { endpoint: 'speech/catalog', payload: { args: {} } },
              expect.any(AbortSignal),
              undefined,
            )
          },
        },
      ],
      async () => {
        await cleanupContract1()
      },
    )
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
  it('ignores a superseded follow snapshot and restores only the latest subscription', async () => {
    const core = new ScriptedCore()
    const frames: Array<{ rpcId: string; payload: Record<string, unknown> }> = []
    const client = new HarnessAlphaClient(core as unknown as RemoteClientCore, {}, frame => frames.push(frame))
    const first = client.sessionHistory('old').then(value => value, error => error)
    await vi.waitFor(() => expect(core.streamIdFor('session/follow')).toBeTruthy())
    const oldId = core.streamIdFor('session/follow')
    const second = client.sessionHistory('new')
    await vi.waitFor(() => expect(core.rpcCalls.filter(call => call.method === 'harness.remote.stream.open')).toHaveLength(2))
    const latest = core.rpcCalls.filter(call => call.method === 'harness.remote.stream.open').at(-1)!.params as { streamId: string }
    core.emit({ event: 'harness.remote.frame', data: { streamId: oldId, hasValue: true,
      value: { type: 'snapshot', cursor: 1, records: [], projections: { asOfSeq: 1, values: { permissions: { currentValue: 'stale' } } } } } })
    core.emit({ event: 'harness.remote.frame', data: { streamId: latest.streamId, hasValue: true,
      value: { type: 'snapshot', cursor: 10, records: [], hasMore: false, projections: { asOfSeq: 10, values: { permissions: { currentValue: 'read-only' } } } } } })
    expect(await first).toMatchObject({ code: 'CANCELLED' })
    expect(await second).toEqual({ events: [], hasMore: false, throughSeq: 10 })
    expect(frames).toMatchObject([{ payload: { sessionId: 'new', key: 'permissions', value: { currentValue: 'read-only' } } }])
    expect(frames).toHaveLength(1)
    await client.close()
  })

  it('normalizes legacy code presets in history and live frames', async () => {
    await runScenarios(
      [
        {
          name: 'normalizes legacy code preset in session list projections',
          run: async () => {
            const core = new ScriptedCore()
            const client = new HarnessAlphaClient(core as unknown as RemoteClientCore)

            const sessions = await client.sessionList()

            expect(sessions).toEqual([
              expect.objectContaining({
                sessionId: 'legacy-session',
                agentPreset: 'ptc',
                projections: {
                  asOfSeq: 4,
                  values: { agentPreset: 'ptc', other: 'code' },
                },
              }),
            ])
          },
        },
        {
          name: 'normalizes legacy code preset in live projection frames',
          run: async () => {
            const core = new ScriptedCore()
            const frames: Array<{ rpcId: string; payload: Record<string, unknown> }> = []
            const client = new HarnessAlphaClient(core as unknown as RemoteClientCore, {}, (frame) =>
              frames.push(frame),
            )

            client.start()
            await vi.waitFor(() => expect(core.streamIdFor('session/control')).toBeTruthy())
            core.emit({
              event: 'harness.remote.frame',
              data: {
                streamId: core.streamIdFor('session/control'),
                hasValue: true,
                value: {
                  type: 'projection',
                  sessionId: 'legacy-session',
                  key: 'agentPreset',
                  value: 'code',
                  seq: 7,
                },
              },
            })

            await vi.waitFor(() => {
              expect(frames).toContainEqual({
                rpcId: '',
                payload: {
                  type: 'session/projection',
                  sessionId: 'legacy-session',
                  key: 'agentPreset',
                  value: 'ptc',
                  seq: 7,
                },
              })
            })
            await client.close()
          },
        },
      ],
      async () => {
        await cleanupContract1()
      },
    )
  }, 10000)

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
      throughSeq: 9,
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
    } }], hasMore: false, throughSeq: 4 })

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

  it('re-emits pending blocking questions and approvals when sessionHistory re-opens the session', async () => {
    const core = new ScriptedCore()
    const frames: Array<{ rpcId: string; payload: Record<string, unknown> }> = []
    const client = new HarnessAlphaClient(
      core as unknown as RemoteClientCore,
      { sessionFormat: 3 },
      frame => frames.push(frame),
    )

    client.start()
    await vi.waitFor(() => expect(core.streamIdFor('$events')).toBeTruthy())
    const eventsStreamId = core.streamIdFor('$events')
    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId: eventsStreamId,
        hasValue: true,
        value: { type: 'ready', clientId: 'client-1', host: { sessionFormat: 3 } },
      },
    })
    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId: eventsStreamId,
        hasValue: true,
        value: {
          type: 'waterfall',
          event: 'user-questions/request',
          eventId: 'evt-q-1',
          agentId: 'session-q',
          request: { questions: [{ id: 'q1', question: 'Confirm?' }] },
        },
      },
    })
    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId: eventsStreamId,
        hasValue: true,
        value: {
          type: 'waterfall',
          event: 'approval/request',
          eventId: 'evt-a-1',
          agentId: 'session-q',
          request: { toolName: 'bash', callId: 'call-1' },
        },
      },
    })
    await vi.waitFor(() => expect(frames.filter(item => item.rpcId === 'evt-q-1')).toHaveLength(1))
    expect(frames.filter(item => item.rpcId === 'evt-a-1')).toHaveLength(1)

    const history = client.sessionHistory('session-q')
    await vi.waitFor(() => expect(core.streamIdFor('session/follow')).toBeTruthy())
    const followStreamId = core.streamIdFor('session/follow')
    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId: followStreamId,
        hasValue: true,
        value: {
          type: 'snapshot',
          cursor: 1,
          records: [],
          hasMore: false,
          projections: { asOfSeq: 1, values: {} },
        },
      },
    })
    await history
    expect(frames.filter(item => item.rpcId === 'evt-q-1')).toHaveLength(2)
    expect(frames.filter(item => item.rpcId === 'evt-a-1')).toHaveLength(2)
    await client.close()
  })

  it('restarts $events and session/control via start() after stream completion or failure', async () => {
    await runScenarios([
      {
        name: 'restarts after next.done stream/closed completed (including synchronous restart in onFrame)',
        run: async () => {
          const core = new ScriptedCore()
          const frames: Array<{ rpcId: string; payload: Record<string, unknown> }> = []
          const client = new HarnessAlphaClient(core as unknown as RemoteClientCore, { sessionFormat: 3 }, frame => {
            frames.push(frame)
            if (frame.payload.type === 'stream/closed' && frame.payload.reason === 'completed') {
              client.start()
            }
          })
          const openedIds = (endpoint: string) => core.rpcCalls
            .filter(call => call.method === 'harness.remote.stream.open' && (call.params as { endpoint?: string }).endpoint === endpoint)
            .map(call => (call.params as { streamId: string }).streamId)

          client.start()
          await vi.waitFor(() => {
            expect(openedIds('$events')).toHaveLength(1)
            expect(openedIds('session/control')).toHaveLength(1)
          })

          // Complete $events -> should emit stream/closed(completed) and restart $events only.
          core.emit({ event: 'harness.remote.stream.closed', data: { streamId: openedIds('$events')[0], reason: 'completed' } })
          await vi.waitFor(() => expect(openedIds('$events')).toHaveLength(2))
          expect(openedIds('session/control')).toHaveLength(1)

          // Complete session/control -> should emit stream/closed(completed) and restart session/control only.
          core.emit({ event: 'harness.remote.stream.closed', data: { streamId: openedIds('session/control')[0], reason: 'completed' } })
          await vi.waitFor(() => expect(openedIds('session/control')).toHaveLength(2))
          expect(frames.filter(f => f.payload.type === 'stream/closed' && f.payload.reason === 'completed')).toHaveLength(2)

          // client.close() must not emit spurious stream/closed.
          await client.close()
          expect(frames.filter(f => f.payload.type === 'stream/closed')).toHaveLength(2)
        },
      },
      {
        name: 'clears handles before emitting stream/closed failed so start() restarts after error',
        run: async () => {
          const core = new ScriptedCore()
          let failNextOpen = true
          const baseRpc = core.rpc.bind(core)
          vi.spyOn(core, 'rpc').mockImplementation(async (method, params) => {
            if (method === 'harness.remote.stream.open' && (params as { endpoint?: string }).endpoint === '$events' && failNextOpen) {
              failNextOpen = false
              core.rpcCalls.push({ method, params })
              throw Object.assign(new Error('events open failed'), { code: 'TRANSPORT_CLOSED' })
            }
            return baseRpc(method, params)
          })
          const frames: Array<{ rpcId: string; payload: Record<string, unknown> }> = []
          const client = new HarnessAlphaClient(core as unknown as RemoteClientCore, { sessionFormat: 3 }, frame => frames.push(frame))
          const openedIds = (endpoint: string) => core.rpcCalls
            .filter(call => call.method === 'harness.remote.stream.open' && (call.params as { endpoint?: string }).endpoint === endpoint)
            .map(call => (call.params as { streamId: string }).streamId)

          client.start()
          await vi.waitFor(() => {
            expect(frames.some(f => f.payload.type === 'stream/closed' && f.payload.reason === 'failed')).toBe(true)
            expect(openedIds('session/control')).toHaveLength(1)
          })

          // Fail session/control mid-stream as well.
          core.emit({
            event: 'harness.remote.stream.closed',
            data: { streamId: openedIds('session/control')[0], reason: 'failed', failure: { code: 'DISCONNECTED', message: 'dropped', details: {} } },
          })
          await vi.waitFor(() => expect(frames.filter(f => f.payload.type === 'stream/closed' && f.payload.reason === 'failed')).toHaveLength(2))

          // start() must now reopen both $events and session/control.
          client.start()
          await vi.waitFor(() => {
            expect(openedIds('$events')).toHaveLength(2)
            expect(openedIds('session/control')).toHaveLength(2)
          })
          await client.close()
        },
      },
    ])
  })

  it('replays activeAttempt.stream on mid-stream sessionHistory join and continues with monotonic seq across abandonment retry', async () => {
    const core = new ScriptedCore()
    const frames: Array<{ rpcId: string; payload: Record<string, unknown> }> = []
    const client = new HarnessAlphaClient(
      core as unknown as RemoteClientCore,
      { sessionFormat: 3 },
      frame => frames.push(frame),
    )

    const historyPromise = client.sessionHistory('session-mid')
    await vi.waitFor(() => expect(core.streamIdFor('session/follow')).toBeTruthy())
    const streamId = core.streamIdFor('session/follow')

    // Snapshot has durable cursor 4 and activeAttempt with 5 packed/raw chunks (nextIndex = 5),
    // plus an extra 6th chunk in stream beyond nextIndex to verify capping at nextIndex.
    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId,
        hasValue: true,
        value: {
          type: 'snapshot',
          cursor: 4,
          records: [{
            type: 'event',
            event: { type: 'step/start', seq: 4, time: 100, data: { turn: 2, step: 1 } },
          }],
          hasMore: false,
          projections: { asOfSeq: 4, values: {} },
          assistantStream: {
            revision: 5,
            activeAttempt: {
              attemptId: 'att-1',
              startedAfterSeq: 4,
              turn: 2,
              step: 1,
              nextIndex: 5,
              stream: [
                { type: 'chunk', time: 101, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
                { type: 'reasoning-chunks', time0: 102, index: 0, dt: [], texts: ['think'] },
                { type: 'text-chunks', time0: 105, index: 1, dt: [3], texts: ['hel', 'lo'] },
                { type: 'tool-call-chunks', time0: 110, index: 2, dt: [1], id: 'tc-1', name: 'bash', args: ['{"cmd":', '"ls"}'] },
              ],
            },
          },
        },
      },
    })

    const page = await historyPromise
    expect(page.throughSeq).toBe(4)
    expect(page.events).toHaveLength(6)
    expect(page.events.slice(1)).toEqual([
      { event: { type: 'assistant/chunk', seq: 4 + 1 - 1 / 2, time: 101, data: { turn: 2, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } } } },
      { event: { type: 'assistant/chunk', seq: 4 + 1 - 1 / 3, time: 102, data: { turn: 2, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'think' } } } },
      { event: { type: 'assistant/chunk', seq: 4 + 1 - 1 / 4, time: 105, data: { turn: 2, step: 1, chunk: { type: 'text-delta', index: 1, text: 'hel' } } } },
      { event: { type: 'assistant/chunk', seq: 4 + 1 - 1 / 5, time: 108, data: { turn: 2, step: 1, chunk: { type: 'text-delta', index: 1, text: 'lo' } } } },
      { event: { type: 'assistant/chunk', seq: 4 + 1 - 1 / 6, time: 110, data: { turn: 2, step: 1, chunk: { type: 'tool-call-delta', index: 2, id: 'tc-1', name: 'bash', argumentsDelta: '{"cmd":' } } } },
    ])

    // Live suffix chunk (index 5) continues seamlessly at transientInGap = 6.
    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId,
        hasValue: true,
        value: {
          type: 'assistant-stream',
          frame: { type: 'chunk', attemptId: 'att-1', revision: 6, index: 5, time: 112, chunk: { type: 'text-delta', index: 1, text: ' world' } },
        },
      },
    })
    // Attempt 1 is abandoned -> synthetic assistant/attempt-abandoned at transientInGap = 7.
    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId,
        hasValue: true,
        value: {
          type: 'assistant-stream',
          frame: { type: 'end', attemptId: 'att-1', revision: 7, index: 6, outcome: { kind: 'abandoned' } },
        },
      },
    })
    // Attempt 2 retries in the same (turn=2, step=1) durable gap (startedAfterSeq: 4).
    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId,
        hasValue: true,
        value: {
          type: 'assistant-stream',
          frame: { type: 'start', attemptId: 'att-2', revision: 8, startedAfterSeq: 4, turn: 2, step: 1 },
        },
      },
    })
    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId,
        hasValue: true,
        value: {
          type: 'assistant-stream',
          frame: { type: 'chunk', attemptId: 'att-2', revision: 9, index: 0, time: 120, chunk: { type: 'text-delta', index: 0, text: 'retry' } },
        },
      },
    })
    // Durable event at seq 5 advances durableCursor and resets transientInGap, so next attempt gets 5.5.
    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId,
        hasValue: true,
        value: {
          type: 'event',
          event: { type: 'step/end', seq: 5, time: 130, data: { turn: 2, step: 1 } },
        },
      },
    })
    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId,
        hasValue: true,
        value: {
          type: 'assistant-stream',
          frame: { type: 'start', attemptId: 'att-3', revision: 10, startedAfterSeq: 5, turn: 2, step: 2 },
        },
      },
    })
    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId,
        hasValue: true,
        value: {
          type: 'assistant-stream',
          frame: { type: 'chunk', attemptId: 'att-3', revision: 11, index: 0, time: 140, chunk: { type: 'text-delta', index: 0, text: 'next' } },
        },
      },
    })

    await vi.waitFor(() => expect(frames.filter(f => f.payload.type === 'session/event')).toHaveLength(5))
    const sessionEvents = frames
      .filter(f => f.payload.type === 'session/event')
      .map(f => f.payload.event as { type: string; seq: number; data: Record<string, unknown> })

    expect(sessionEvents.map(e => e.type)).toEqual([
      'assistant/chunk',
      'assistant/attempt-abandoned',
      'assistant/chunk',
      'step/end',
      'assistant/chunk',
    ])
    expect(sessionEvents[0]!.seq).toBe(4 + 1 - 1 / 7)
    expect(sessionEvents[1]).toMatchObject({
      type: 'assistant/attempt-abandoned',
      seq: 4 + 1 - 1 / 8,
      data: { turn: 2, step: 1, attemptId: 'att-1' },
    })
    expect(sessionEvents[2]!.seq).toBe(4 + 1 - 1 / 9)
    expect(sessionEvents[3]!.seq).toBe(5)
    expect(sessionEvents[4]!.seq).toBe(5.5)
    // All seqs from mid-stream replay through retry stay strictly monotonic.
    const allSeqs = [...page.events.map(e => e.event.seq), ...sessionEvents.map(e => e.seq)]
    for (let i = 1; i < allSeqs.length; i += 1) {
      expect(allSeqs[i]).toBeGreaterThan(allSeqs[i - 1]!)
    }

    await client.close()
  })

  it('reads another session read-only via session/page without closing an active sessionFollow', async () => {
    const core = new ScriptedCore()
    const frames: Array<{ rpcId: string; payload: Record<string, unknown> }> = []
    const client = new HarnessAlphaClient(core as unknown as RemoteClientCore, {}, frame => frames.push(frame))
    const originalRpc = core.rpc.bind(core)
    vi.spyOn(core, 'rpc').mockImplementation(async (method, params) => {
      if (method === 'harness.remote.call' && (params as { endpoint?: string }).endpoint === 'session/page') {
        await originalRpc(method, params)
        const req = (params as { payload?: { args?: { request?: Record<string, unknown> } } }).payload?.args?.request
        if ((req?.address as { sessionId?: string } | undefined)?.sessionId === 'other-session') {
          return {
            ok: true,
            value: {
              records: [
                { type: 'event', event: { type: 'user/message', seq: 1, time: 100, data: { content: 'hi' } } },
                { type: 'chunks', event: { type: 'chunkrow/text-chunks', seq: 2, time: 110, data: { turn: 1, step: 1, index: 0, dt: [4], texts: ['he', 'y'] } } },
              ],
              hasMore: true,
            },
          }
        }
        return { ok: true, value: { records: [], hasMore: false } }
      }
      return await originalRpc(method, params)
    })

    const activeHistory = client.sessionHistory('active-session')
    await vi.waitFor(() => expect(core.streamIdFor('session/follow')).toBeTruthy())
    const activeStreamId = core.streamIdFor('session/follow')
    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId: activeStreamId,
        hasValue: true,
        value: { type: 'snapshot', cursor: 4, records: [], hasMore: false, projections: { asOfSeq: 4, values: {} } },
      },
    })
    await expect(activeHistory).resolves.toEqual({ events: [], hasMore: false, throughSeq: 4 })

    const readOnly = await client.sessionReadOnlyHistory('other-session', 60)
    expect(readOnly).toEqual({
      events: [
        { event: { type: 'user/message', seq: 1, time: 100, data: { content: 'hi' } } },
        { event: { type: 'assistant/chunk', seq: 2, time: 110, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'he' } } } },
        { event: { type: 'assistant/chunk', seq: 3, time: 114, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'y' } } } },
      ],
      hasMore: true,
      throughSeq: 3,
    })

    // Active sessionFollow must remain open and still receive live frames.
    expect(core.rpcCalls.filter(call => call.method === 'harness.remote.stream.close')).toHaveLength(0)
    expect(core.rpcCalls.filter(call => call.method === 'harness.remote.stream.open')).toHaveLength(1)
    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId: activeStreamId,
        hasValue: true,
        value: { type: 'event', event: { type: 'user/message', seq: 5, time: 200, data: { content: 'still live' } } },
      },
    })
    await vi.waitFor(() => expect(frames).toContainEqual({
      rpcId: '',
      payload: {
        type: 'session/event',
        sessionId: 'active-session',
        event: { type: 'user/message', seq: 5, time: 200, data: { content: 'still live' } },
      },
    }))

    // Active session pagination still sees its preserved followCursor.
    await client.sessionHistory('active-session', 2, 20)
    const activePageCall = core.rpcCalls.findLast(call => call.method === 'harness.remote.call'
      && (call.params as { endpoint?: string }).endpoint === 'session/page')
    expect((activePageCall?.params as { payload?: unknown })?.payload).toEqual({
      args: { request: { address: { kind: 'session', sessionId: 'active-session' }, throughSeq: 4, beforeSeq: 2, maxMessages: 20 } },
    })
    await client.close()
  })

  it('falls back to session/events and slices maxMessages when session/page returns METHOD_NOT_FOUND', async () => {
    const core = new ScriptedCore()
    const client = new HarnessAlphaClient(core as unknown as RemoteClientCore)
    const originalRpc = core.rpc.bind(core)
    vi.spyOn(core, 'rpc').mockImplementation(async (method, params) => {
      if (method === 'harness.remote.call') {
        const request = params as { endpoint?: string; payload?: unknown }
        if (request.endpoint === 'session/page') {
          return { ok: false, error: { code: 'METHOD_NOT_FOUND', message: 'session/page unsupported', details: {} } }
        }
        if (request.endpoint === 'session/events') {
          expect(request.payload).toEqual({
            args: {
              request: {
                address: { kind: 'subagent', parentSessionId: 'parent-1', childSessionId: 'child-1', mode: 'unknown' },
              },
            },
          })
          return {
            ok: true,
            value: {
              events: [
                { type: 'user/message', seq: 1, time: 100, data: { content: 'old' } },
                { type: 'assistant/message', seq: 2, time: 105, data: { content: 'mid' } },
                { type: 'user/message', seq: 3, time: 110, data: { content: 'new' } },
              ],
            },
          }
        }
      }
      return await originalRpc(method, params)
    })

    const page = await client.sessionReadOnlyHistory('child-1', 2, 'parent-1')
    expect(page).toEqual({
      events: [
        { event: { type: 'assistant/message', seq: 2, time: 105, data: { content: 'mid' } } },
        { event: { type: 'user/message', seq: 3, time: 110, data: { content: 'new' } } },
      ],
      hasMore: true,
      throughSeq: 3,
    })
    await client.close()
  })

  it('preserves user prompt and complete chunked assistant stream (>60 chunks) on session/events fallback', async () => {
    const core = new ScriptedCore()
    const client = new HarnessAlphaClient(core as unknown as RemoteClientCore)
    const originalRpc = core.rpc.bind(core)
    const texts = Array.from({ length: 75 }, (_, idx) => `tok-${idx} `)
    vi.spyOn(core, 'rpc').mockImplementation(async (method, params) => {
      if (method === 'harness.remote.call') {
        const request = params as { endpoint?: string }
        if (request.endpoint === 'session/page') {
          return { ok: false, error: { code: 'gateway/arguments-invalid', message: 'invalid page args', details: {} } }
        }
        if (request.endpoint === 'session/events') {
          return {
            ok: true,
            value: {
              records: [
                { type: 'event', event: { type: 'user/message', seq: 1, time: 100, data: { content: 'keep this goal' } } },
                {
                  type: 'chunks',
                  event: {
                    type: 'chunkrow/text-chunks',
                    seq: 2,
                    time: 101,
                    data: { turn: 1, step: 1, index: 0, texts, dt: texts.slice(1).map(() => 1) },
                  },
                },
                { type: 'event', event: { type: 'turn/end', seq: 80, time: 200, data: { turn: 1 } } },
              ],
            },
          }
        }
      }
      return await originalRpc(method, params)
    })

    const page = await client.sessionReadOnlyHistory('chunked-1', 60)
    expect(page.hasMore).toBe(false)
    expect(page.throughSeq).toBe(80)
    expect(page.events[0]).toEqual({
      event: { type: 'user/message', seq: 1, time: 100, data: { content: 'keep this goal' } },
    })
    const chunkEntries = page.events.filter(entry => entry.event.type === 'assistant/chunk')
    expect(chunkEntries).toHaveLength(75)
    expect(page.events.at(-1)).toEqual({
      event: { type: 'turn/end', seq: 80, time: 200, data: { turn: 1 } },
    })
    await client.close()
  })

  it('returns empty session/page records without calling session/events fallback', async () => {
    const core = new ScriptedCore()
    const client = new HarnessAlphaClient(core as unknown as RemoteClientCore)
    const originalRpc = core.rpc.bind(core)
    const eventsCalled = vi.fn()
    vi.spyOn(core, 'rpc').mockImplementation(async (method, params) => {
      if (method === 'harness.remote.call') {
        const request = params as { endpoint?: string }
        if (request.endpoint === 'session/page') {
          return { ok: true, value: { records: [], hasMore: false } }
        }
        if (request.endpoint === 'session/events') {
          eventsCalled()
          return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'should not be called', details: {} } }
        }
      }
      return await originalRpc(method, params)
    })

    const page = await client.sessionReadOnlyHistory('empty-session', 60)
    expect(page).toEqual({ events: [], hasMore: false })
    expect(eventsCalled).not.toHaveBeenCalled()
    await client.close()
  })
})


describe('HarnessAlphaClient.sessionAttachment', () => {
  const data = 'iVBORw0KGgo='
  const makeCore = () => ({
    rpc: vi.fn(async (method: string, params: any) => {
      if (method === 'harness.remote.call' && params?.endpoint === 'session/attachment') {
        return { ok: true, value: { attachment: { mediaType: 'image/png' }, data } }
      }
      return { ok: true, value: {} }
    }),
  })
  const requestOf = (core: ReturnType<typeof makeCore>) => {
    const call = core.rpc.mock.calls.find(([method, params]) =>
      method === 'harness.remote.call' && params?.endpoint === 'session/attachment')
    return call?.[1]?.payload?.args?.request
  }

  it('keeps the id-only request for a string attachmentId', async () => {
    const core = makeCore()
    const client = new HarnessAlphaClient(core as any)
    await client.sessionAttachment('s1', 'att-1')
    expect(requestOf(core)).toEqual({ sessionId: 's1', attachmentId: 'att-1' })
  })

  it('keeps both attachment and attachmentId for a full reference', async () => {
    const core = makeCore()
    const client = new HarnessAlphaClient(core as any)
    const reference = { attachmentId: 'att-1', mediaType: 'image/png', bytes: 8, width: 4, height: 2, name: 'a.png' }
    const result = await client.sessionAttachment('s1', reference)
    expect(result.data).toBe(data)
    expect(requestOf(core)).toEqual({ sessionId: 's1', attachmentId: 'att-1', attachment: reference })
  })
})

describe('HarnessAlphaClient async compaction', () => {
  function recordingCore(handle: (method: string, params: any) => unknown) {
    const methods: string[] = []
    const core = {
      rpc: vi.fn(async (method: string, params: any) => {
        methods.push(method)
        return handle(method, params)
      }),
    } as unknown as RemoteClientCore
    return { core, methods }
  }

  it('runs /compact as a tracked Host operation instead of one long RPC', async () => {
    const { core, methods } = recordingCore((method) => {
      if (method === 'harness.remote.compaction.submit') return { operationId: 'op-1', state: 'accepted' }
      if (method === 'harness.remote.compaction.status') {
        return { operationId: 'op-1', sessionId: 's1', state: 'succeeded', message: 'Compacted.' }
      }
      throw new Error(`unexpected ${method}`)
    })
    const client = new HarnessAlphaClient(core, { capabilities: [REMOTE_COMPACTION_CAPABILITY] })

    await expect(client.sessionExecuteCommand('s1', '/compact')).resolves.toEqual({ kind: 'success', text: 'Compacted.' })
    expect(methods).toEqual([
      'harness.remote.compaction.submit',
      'harness.remote.compaction.status',
    ])
    expect(methods).not.toContain('harness.remote.call')
  })

  it('polls until a running operation settles', async () => {
    let polls = 0
    const { core, methods } = recordingCore((method) => {
      if (method === 'harness.remote.compaction.submit') return { operationId: 'op-2', state: 'accepted' }
      polls += 1
      return {
        operationId: 'op-2',
        sessionId: 's1',
        state: polls < 3 ? 'running' : 'succeeded',
      }
    })
    const client = new HarnessAlphaClient(core, { capabilities: [REMOTE_COMPACTION_CAPABILITY] })
    const status = await client.compactSession('s1', { pollIntervalMs: 1 })
    expect(status.state).toBe('succeeded')
    expect(methods.filter(method => method === 'harness.remote.compaction.status')).toHaveLength(3)
  })

  it('resumes observation without submitting a second compaction', async () => {
    const { core, methods } = recordingCore((method) => {
      if (method !== 'harness.remote.compaction.status') throw new Error(`unexpected ${method}`)
      return { operationId: 'op-3', sessionId: 's1', state: 'succeeded' }
    })
    const client = new HarnessAlphaClient(core, { capabilities: [REMOTE_COMPACTION_CAPABILITY] })
    await expect(client.compactSession('s1', { operationId: 'op-3', pollIntervalMs: 1 }))
      .resolves.toMatchObject({ state: 'succeeded' })
    expect(methods).toEqual(['harness.remote.compaction.status'])
  })

  it('keeps the legacy command path for Hosts without the capability', async () => {
    const { core, methods } = recordingCore((method) => {
      if (method !== 'harness.remote.call') throw new Error(`unexpected ${method}`)
      return { ok: true, value: { result: { kind: 'success', text: 'legacy' } } }
    })
    const client = new HarnessAlphaClient(core, {})
    await expect(client.sessionExecuteCommand('s1', '/compact')).resolves.toEqual({ kind: 'success', text: 'legacy' })
    expect(methods).toEqual(['harness.remote.call'])
  })
})

describe('HarnessAlphaClient tracked compaction', () => {
  class MemoryStore {
    records = new Map<string, any>()
    async load(scope: string, sessionId: string) { return this.records.get(`${scope}:${sessionId}`) }
    async list(scope: string) {
      return [...this.records.entries()]
        .filter(([key]) => key.startsWith(`${scope}:`))
        .map(([, record]) => record)
    }
    async save(scope: string, record: any) { this.records.set(`${scope}:${record.sessionId}`, record) }
    async remove(scope: string, sessionId: string) { this.records.delete(`${scope}:${sessionId}`) }
  }

  function trackedCore(handle: (method: string, params: any) => unknown) {
    const calls: Array<{ method: string; params: any }> = []
    const core = {
      rpc: vi.fn(async (method: string, params: any) => {
        calls.push({ method, params })
        return handle(method, params)
      }),
    } as unknown as RemoteClientCore
    return { core, calls }
  }

  it('retries a lost submit response with the same requestId instead of starting twice', async () => {
    let submits = 0
    const { core, calls } = trackedCore((method) => {
      if (method === 'harness.remote.compaction.submit') {
        submits += 1
        if (submits === 1) throw Object.assign(new Error('response lost'), { code: 'RPC_TIMEOUT' })
        return { operationId: 'op-1', state: 'accepted' }
      }
      if (method === 'harness.remote.compaction.status') {
        return { operationId: 'op-1', sessionId: 's1', state: 'succeeded', message: 'done' }
      }
      throw new Error(`unexpected ${method}`)
    })
    const store = new MemoryStore()
    const client = new HarnessAlphaClient(core, { capabilities: [REMOTE_COMPACTION_CAPABILITY] }, undefined, {
      store, scope: 'host-1',
    })
    const outcome = await client.compactSessionTracked('s1', { pollIntervalMs: 1 })
    expect(outcome.kind).toBe('settled')
    const requestIds = calls
      .filter(call => call.method === 'harness.remote.compaction.submit')
      .map(call => call.params.requestId)
    expect(requestIds).toHaveLength(2)
    expect(requestIds[1]).toBe(requestIds[0])
    expect(store.records.size).toBe(0)
  })

  it('keeps the operation id across an observation failure and resumes without resubmitting', async () => {
    let submitCalls = 0
    let failPolls = 3
    const { core, calls } = trackedCore((method) => {
      if (method === 'harness.remote.compaction.submit') {
        submitCalls += 1
        return { operationId: 'op-2', state: 'accepted' }
      }
      if (method === 'harness.remote.compaction.status') {
        if (failPolls > 0) {
          failPolls -= 1
          throw Object.assign(new Error('offline'), { code: 'TRANSPORT_CLOSED' })
        }
        return { operationId: 'op-2', sessionId: 's1', state: 'succeeded' }
      }
      throw new Error(`unexpected ${method}`)
    })
    const store = new MemoryStore()
    const client = new HarnessAlphaClient(core, { capabilities: [REMOTE_COMPACTION_CAPABILITY] }, undefined, {
      store, scope: 'host-1',
    })
    const first = await client.compactSessionTracked('s1', { pollIntervalMs: 1 })
    expect(first.kind).toBe('unconfirmed')
    expect(submitCalls).toBe(1)
    expect(store.records.get('host-1:s1')).toMatchObject({ operationId: 'op-2' })

    // A reconnect observes the same operation; it never submits again.
    const resumed = await client.resumeCompactions()
    expect(resumed).toEqual([{ sessionId: 's1', outcome: expect.objectContaining({ kind: 'settled' }) }])
    expect(submitCalls).toBe(1)
    expect(calls.filter(call => call.method === 'harness.remote.compaction.submit')).toHaveLength(1)
    expect(store.records.size).toBe(0)
  })


  it('cancels the saved operation on an explicit cancel request', async () => {
    const { core, calls } = trackedCore((method) => {
      if (method === 'harness.remote.compaction.submit') return { operationId: 'op-4', state: 'accepted' }
      if (method === 'harness.remote.compaction.status') {
        return { operationId: 'op-4', sessionId: 's1', state: 'running' }
      }
      if (method === 'harness.remote.compaction.cancel') {
        return { operationId: 'op-4', sessionId: 's1', state: 'cancelled', message: 'Compaction cancelled.' }
      }
      throw new Error(`unexpected ${method}`)
    })
    const store = new MemoryStore()
    await store.save('host-1', {
      sessionId: 's1', requestId: 'request-4', operationId: 'op-4', state: 'running', updatedAt: Date.now(),
    })
    const client = new HarnessAlphaClient(core, { capabilities: [REMOTE_COMPACTION_CAPABILITY] }, undefined, {
      store, scope: 'host-1',
    })
    await expect(client.cancelTrackedCompaction('s1')).resolves.toMatchObject({ state: 'cancelled' })
    expect(calls.filter(call => call.method === 'harness.remote.compaction.cancel')).toHaveLength(1)
    expect(calls.some(call => call.method === 'harness.remote.compaction.submit')).toBe(false)
    expect(store.records.size).toBe(0)
  })

  it('does not replay a stale request that never produced an operation id', async () => {
    const { core, calls } = trackedCore((method) => {
      throw new Error(`unexpected ${method}`)
    })
    const store = new MemoryStore()
    await store.save('host-1', {
      sessionId: 's1', requestId: 'old-request', state: 'accepted', updatedAt: Date.now() - 10 * 60_000,
    })
    const client = new HarnessAlphaClient(core, { capabilities: [REMOTE_COMPACTION_CAPABILITY] }, undefined, {
      store, scope: 'host-1',
    })
    const outcome = await client.compactSessionTracked('s1')
    expect(outcome.kind).toBe('unconfirmed')
    expect(calls).toHaveLength(0)
    expect(store.records.size).toBe(0)
  })
})


describe('HarnessAlphaClient file attachments', () => {
  it('uploads into the receiving Agent and submits only the staged receipt', async () => {
    const rpc = vi.fn(async (_method: string, params: any) => ({ ok: true, value:
      params.endpoint === 'fileUploads/upload' ? { receiptId: 'receipt-s1', file: { name: 'report.pdf' } } : {} }))
    const client = new HarnessAlphaClient({ rpc } as any)
    const uploaded = await client.sessionUploadFile('s1', 'JVBERi0x', 'report.pdf')
    await client.sessionPrompt('s1', 'Read this', 'request-1', [], [uploaded])
    expect(rpc.mock.calls[0]?.[1]).toEqual({ endpoint: 'fileUploads/upload', payload: { args: {
      agentId: 's1', request: { data: 'JVBERi0x', name: 'report.pdf' },
    } } })
    expect(rpc.mock.calls[1]?.[1].payload.args.request.mode).toBe('queue')
    expect(rpc.mock.calls[1]?.[1].payload.args.request.content).toEqual([
      { type: 'file', receiptId: 'receipt-s1' }, { type: 'text', text: 'Read this' },
    ])
  })

  it('forwards explicit steer mode on sessionPrompt when requested', async () => {
    const rpc = vi.fn(async () => ({ ok: true, value: {} }))
    const client = new HarnessAlphaClient({ rpc } as any)
    await client.sessionPrompt('s1', 'Interrupt now', 'request-steer-1', [], [], 'steer')
    expect(rpc.mock.calls[0]?.[1]).toEqual({
      endpoint: 'session/prompt',
      payload: {
        args: {
          request: expect.objectContaining({
            requestId: 'request-steer-1',
            sessionId: 's1',
            mode: 'steer',
            content: [{ type: 'text', text: 'Interrupt now' }],
          }),
        },
      },
    })
  })
})

describe('HarnessAlphaClient live session events and control changes', () => {
  it('recognizes session events and valid IPv6 endpoint hints in transport discovery', async () => {
    const transport = new LoopbackTransport()
    const client = new RemoteClientCore(transport)
    await client.connect()
    const probing = probeRemoteHostFeatures(client)
    const request = JSON.parse(new TextDecoder().decode(transport.sent[0]!))

    transport.push(
      encodeMessage(
        createRpcResponse(request.id, {
          capabilities: ['harness.remote.v3', 'remote.session.events.v1'],
          sameLinkIpv6Endpoints: ['2001:db8::1:443', '2001:db8::1:65536', '192.168.1.1:443'],
        }),
      ),
    )

    await expect(probing).resolves.toMatchObject({
      remoteGateway: true,
      sessionFormat: 3,
      sessionEvents: true,
      sameLinkIpv6Endpoints: ['2001:db8::1:443'],
    })
    await cleanupContract1()
  })

  it('forwards api-session/* emit frames and DSH 0.2.2 projection changes without false initial baseline pulls', async () => {
    const core = new ScriptedCore()
    const frames: Array<{ rpcId: string; payload: Record<string, unknown> }> = []
    const client = new HarnessAlphaClient(core as unknown as RemoteClientCore, { capabilities: ['harness.remote.v3', 'remote.session.events.v1'] }, frame => frames.push(frame))

    client.start()
    await vi.waitFor(() => expect(core.streamIdFor('$events')).toBeTruthy())
    await vi.waitFor(() => expect(core.streamIdFor('session/control')).toBeTruthy())
    const eventsStreamId = core.streamIdFor('$events')
    const controlStreamId = core.streamIdFor('session/control')

    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId: controlStreamId,
        hasValue: true,
        value: {
          type: 'baseline',
          value: {
            projections: {
              s1: { asOfSeq: 1, values: { title: 'Initial' } },
            },
          },
        },
      },
    })
    await vi.waitFor(() => expect(frames.some(f => f.payload.type === 'session/projection')).toBe(true))
    expect(frames.some(f => f.payload.type === 'session/catalog-changed')).toBe(false)

    const originalRpc = core.rpc.bind(core)
    vi.spyOn(core, 'rpc').mockImplementation(async (method, params) => {
      if (method === 'harness.remote.call' && (params as any).endpoint === 'session/list') {
        return { ok: true, value: { items: [{ sessionId: 's1', updatedAt: 100, running: false, blank: false }] } }
      }
      return await originalRpc(method, params)
    })
    await client.sessionList()

    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId: controlStreamId,
        hasValue: true,
        value: {
          type: 'projection',
          sessionId: 's1',
          seq: 2,
          changes: [{ key: 'title', val: 'Renamed' }],
        },
      },
    })
    await vi.waitFor(() => {
      expect(frames).toContainEqual({
        rpcId: '',
        payload: { type: 'session/projection', sessionId: 's1', key: 'title', value: 'Renamed', seq: 2 },
      })
    })
    expect(frames.some(f => f.payload.type === 'session/catalog-changed')).toBe(false)

    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId: controlStreamId,
        hasValue: true,
        value: {
          type: 'projection',
          sessionId: 's-unknown',
          seq: 1,
          changes: [{ key: 'title', val: 'From Reconnect' }],
        },
      },
    })
    await vi.waitFor(() => {
      expect(frames).toContainEqual({
        rpcId: '',
        payload: { type: 'session/catalog-changed', reason: 'control-projection', sessionId: 's-unknown' },
      })
    })

    core.emit({
      event: 'harness.remote.frame',
      data: {
        streamId: eventsStreamId,
        hasValue: true,
        value: {
          type: 'emit',
          event: 'api-session/added',
          args: [{ sessionId: 's2', updatedAt: 200, running: false, blank: true, projections: { asOfSeq: 0, values: { title: 'Child' } } }],
        },
      },
    })
    core.emit({
      event: 'harness.remote.frame',
      data: { streamId: eventsStreamId, hasValue: true, value: { type: 'emit', event: 'api-session/status', args: ['s2', true] } },
    })
    core.emit({
      event: 'harness.remote.frame',
      data: { streamId: eventsStreamId, hasValue: true, value: { type: 'emit', event: 'api-session/activity', args: ['s2', 250] } },
    })
    core.emit({
      event: 'harness.remote.frame',
      data: { streamId: eventsStreamId, hasValue: true, value: { type: 'emit', event: 'api-session/error', args: ['s2', 'Turn failed'] } },
    })
    core.emit({
      event: 'harness.remote.frame',
      data: { streamId: eventsStreamId, hasValue: true, value: { type: 'emit', event: 'api-session/removed', args: ['s2'] } },
    })

    await vi.waitFor(() => {
      expect(frames.some(f => f.payload.type === 'session/added' && (f.payload.session as any).title === 'Child' && f.payload.known === false)).toBe(true)
      expect(frames).toContainEqual({ rpcId: '', payload: { type: 'session/status', sessionId: 's2', running: true } })
      expect(frames).toContainEqual({ rpcId: '', payload: { type: 'session/activity', sessionId: 's2', updatedAt: 250 } })
      expect(frames).toContainEqual({ rpcId: '', payload: { type: 'session/error', sessionId: 's2', message: 'Turn failed' } })
      expect(frames).toContainEqual({ rpcId: '', payload: { type: 'session/removed', sessionId: 's2', existed: true } })
    })

    await client.close()
  })
})
