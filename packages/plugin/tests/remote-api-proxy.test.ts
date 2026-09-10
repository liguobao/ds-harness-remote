import { describe, expect, it } from 'vitest'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RemoteClientCore, RemoteClientError, type RemoteClientErrorCode } from '@dsh-remote/client-core'
import { createRpcResponse, decodeMessage, encodeMessage } from '@dsh-remote/protocol'
import { BaseTransport } from '@dsh-remote/webrtc'
import { RemoteHarnessApiProxy } from '../src/remote-api-proxy.js'
import { HarnessApiBridge } from '../src/harness-api-bridge.js'

class StreamTransport extends BaseTransport {
  readonly sent: Uint8Array[] = []
  private closed = false

  async connect(): Promise<void> {}

  async send(data: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('transport closed')
    this.sent.push(data)
  }

  async close(): Promise<void> {
    this.closed = true
  }

  getStats() { return { mode: 'Relay' as const, connected: !this.closed } }
  push(data: Uint8Array): void { this.emit(data) }
}

function clientThatFailsWith(error: Error): RemoteClientCore {
  return {
    rpc: async () => { throw error },
    onEvent: () => () => undefined,
    onClose: () => () => undefined,
  } as unknown as RemoteClientCore
}

function clientThatReturns(response: unknown): RemoteClientCore {
  return {
    rpc: async () => response,
    onEvent: () => () => undefined,
    onClose: () => () => undefined,
  } as unknown as RemoteClientCore
}

describe('RemoteHarnessApiProxy', () => {
  it('maps legacy code preset requests to ptc before forwarding them to Harness', async () => {
    const calls: Array<{ method: string; params: unknown }> = []
    const client = {
      rpc: async (method: string, params: unknown) => {
        calls.push({ method, params })
        return {
          rpcId: (params as { rpcId: string }).rpcId,
          result: { ok: true, value: {} },
        }
      },
      onEvent: () => () => undefined,
      onClose: () => () => undefined,
    } as unknown as RemoteClientCore
    const proxy = new RemoteHarnessApiProxy(client)

    await proxy.api.agentPresets.read({ rpcId: 'read-1' as never, payload: { agentPreset: 'code' } as never })
    await proxy.api.agentPresets.select({ rpcId: 'select-1' as never, payload: { agentPreset: 'code' } as never })
    await proxy.api.agentPresets.copy({ rpcId: 'copy-1' as never, payload: { from: 'code' } as never })
    await proxy.api.settings.update({
      rpcId: 'settings-1' as never,
      payload: { ns: 'agent-presets', patch: { default: 'code', other: 'code' } } as never,
    })

    expect(calls.map(call => (call.params as { method: string; payload: unknown }).payload)).toEqual([
      { agentPreset: 'ptc' },
      { agentPreset: 'ptc' },
      { from: 'ptc' },
      { ns: 'agent-presets', patch: { default: 'ptc', other: 'code' } },
    ])
  })

  it('uses the bounded transfer path to read an rc.2 session image from the Host', async () => {
    const imageData = 'A'.repeat(2 * 1024 * 1024)
    const bridge = new HarnessApiBridge({
      sessions: {
        attachment: async (request: { rpcId: string }) => ({
          rpcId: request.rpcId,
          result: { ok: true, value: { mediaType: 'image/png', data: imageData } },
        }),
      },
      subagents: {}, host: {}, workspace: {}, skills: {}, agentPresets: {}, goals: {}, settings: {}, credentials: {}, llm: {},
      events: { mux: async function* () { return }, host: async function* () { return } },
      downloads: {},
      respond: async () => ({ accepted: true }),
    } as unknown as ApiProxy, async () => undefined)
    const calls: string[] = []
    const client = {
      rpc: async (method: string, params: unknown) => {
        calls.push(method)
        switch (method) {
          case 'harness.api.transfer.open': return bridge.openTransfer(params)
          case 'harness.api.transfer.chunk': return bridge.appendTransfer(params)
          case 'harness.api.transfer.commit': return bridge.commitTransfer(params)
          case 'harness.api.transfer.read': return bridge.readTransfer(params)
          case 'harness.api.transfer.close': return bridge.closeTransfer(params)
          default: throw new Error(`Unexpected method ${method}`)
        }
      },
      onEvent: () => () => undefined,
      onClose: () => () => undefined,
    } as unknown as RemoteClientCore
    const proxy = new RemoteHarnessApiProxy(client)

    await expect(proxy.api.sessions.attachment({
      rpcId: 'attachment-rpc-1' as never,
      payload: { sessionId: 'session-1', attachmentId: 'attachment-1' } as never,
    })).resolves.toMatchObject({
      result: { ok: true, value: { mediaType: 'image/png', data: imageData } },
    })
    expect(calls[0]).toBe('harness.api.transfer.open')
    expect(calls).toContain('harness.api.transfer.read')
    expect(calls.at(-1)).toBe('harness.api.transfer.close')
  })

  it('backfills the RC8 home field for an RC7 host.describe response', async () => {
    const proxy = new RemoteHarnessApiProxy(clientThatReturns({
      rpcId: 'describe-1',
      result: {
        ok: true,
        value: {
          version: '0.0.1',
          cwd: '/home/tester',
          attachedSessions: 0,
          canOpenPath: true,
        },
      },
    }))

    await expect(proxy.api.host.describe({ rpcId: 'describe-1' as never, payload: {} }))
      .resolves.toMatchObject({ result: { ok: true, value: { cwd: '/home/tester', home: '/home/tester' } } })
  })

  it.each([
    'TRANSPORT_CLOSED',
    'CLIENT_CLOSED',
  ] satisfies RemoteClientErrorCode[])('ends an event stream cleanly on %s', async code => {
    const proxy = new RemoteHarnessApiProxy(clientThatFailsWith(new RemoteClientError(code, 'remote disconnected')))
    const frames = []

    for await (const frame of proxy.api.events.mux({ rpcId: 'mux-1' as never, payload: {} }, new AbortController().signal)) {
      frames.push(frame)
    }

    expect(frames).toEqual([])
  })

  it('ends an opened event stream when the client closes explicitly', async () => {
    const transport = new StreamTransport()
    const client = new RemoteClientCore(transport)
    const proxy = new RemoteHarnessApiProxy(client)
    await client.connect()
    const iterator = proxy.api.events.mux(
      { rpcId: 'mux-1' as never, payload: {} },
      new AbortController().signal,
    )[Symbol.asyncIterator]()

    const next = iterator.next()
    const openRequest = decodeMessage(transport.sent[0]!)
    transport.push(encodeMessage(createRpcResponse(openRequest.id, { opened: true })))
    await Promise.resolve()

    await client.close()

    await expect(next).resolves.toEqual({ done: true, value: undefined })
  })

  it('does not classify legacy disconnect text without a structured error code', async () => {
    const proxy = new RemoteHarnessApiProxy(clientThatFailsWith(new Error('remote client closed')))
    const consume = async () => {
      for await (const _frame of proxy.api.events.mux({ rpcId: 'mux-1' as never, payload: {} }, new AbortController().signal)) {
        // no-op
      }
    }

    await expect(consume()).rejects.toThrow('remote client closed')
  })

  it('preserves unexpected event stream failures', async () => {
    const proxy = new RemoteHarnessApiProxy(clientThatFailsWith(new Error('invalid remote response')))
    const consume = async () => {
      for await (const _frame of proxy.api.events.mux({ rpcId: 'mux-1' as never, payload: {} }, new AbortController().signal)) {
        // no-op
      }
    }

    await expect(consume()).rejects.toThrow('invalid remote response')
  })
})
