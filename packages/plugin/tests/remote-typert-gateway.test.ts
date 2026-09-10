import type { RemoteClientCore } from '@dsh-remote/client-core'
import type { EventPayload } from '@dsh-remote/protocol'
import { describe, expect, it, vi } from 'vitest'
import { RemoteTypertGateway } from '../src/remote-typert-gateway.js'

describe('RemoteTypertGateway', () => {
  it('retries an oversized direct response through the bounded transfer path', async () => {
    const methods: string[] = []
    const rpc = vi.fn(async (method: string, params: unknown) => {
      methods.push(method)
      if (method === 'harness.remote.call') {
        throw Object.assign(new Error('too large'), { code: 'RESPONSE_TOO_LARGE' })
      }
      if (method === 'harness.remote.transfer.commit') {
        return { kind: 'inline', response: { ok: true, value: 'from-transfer' } }
      }
      if (method === 'harness.remote.transfer.close') {
        return { closed: true, transferId: (params as { transferId: string }).transferId }
      }
      return { accepted: true }
    })
    const client = { rpc } as unknown as RemoteClientCore

    await expect(new RemoteTypertGateway(client).dispatch(
      'session/list',
      { args: {} },
      new AbortController().signal,
    )).resolves.toEqual({ ok: true, value: 'from-transfer' })
    expect(methods).toEqual([
      'harness.remote.call',
      'harness.remote.transfer.open',
      'harness.remote.transfer.chunk',
      'harness.remote.transfer.commit',
      'harness.remote.transfer.close',
    ])
  })

  it('preserves an explicit undefined stream item before the terminal event', async () => {
    let eventHandler: ((event: EventPayload) => void) | undefined
    let streamId: string | undefined
    const rpc = vi.fn(async (method: string, params: unknown) => {
      if (method === 'harness.remote.stream.open') {
        streamId = (params as { streamId: string }).streamId
        return { opened: true, streamId }
      }
      return { closed: true, streamId }
    })
    const client = {
      rpc,
      onEvent: (handler: (event: EventPayload) => void) => {
        eventHandler = handler
        return () => undefined
      },
      onClose: () => () => undefined,
    } as unknown as RemoteClientCore
    const source = await new RemoteTypertGateway(client).open(
      'session/control',
      { args: {} },
      new AbortController().signal,
    )
    const iterator = source[Symbol.asyncIterator]()

    eventHandler?.({ event: 'harness.remote.frame', data: { streamId, hasValue: true } } as EventPayload)
    await expect(iterator.next()).resolves.toEqual({ done: false, value: undefined })
    eventHandler?.({
      event: 'harness.remote.stream.closed',
      data: { streamId, reason: 'completed' },
    } as EventPayload)
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(rpc).toHaveBeenCalledWith('harness.remote.stream.close', { streamId })
  })

  it('normalizes legacy session pages for Session V3 clients', async () => {
    const client = {
      rpc: vi.fn(async () => ({
        ok: true,
        value: {
          records: [{
            type: 'event',
            event: {
              type: 'request/header',
              seq: 2,
              time: 123,
              data: { header: { system: 'old prompt', tools: [], adapterDefaults: {}, model: 'deepseek' } },
            },
          }],
          hasMore: false,
        },
      })),
    } as unknown as RemoteClientCore

    await expect(new RemoteTypertGateway(client, 'legacy-to-v3').dispatch(
      'session/page',
      { args: {} },
      new AbortController().signal,
    )).resolves.toEqual({
      ok: true,
      value: {
        records: [{
          type: 'event',
          event: {
            type: 'request/header',
            seq: 2,
            time: 123,
            data: { header: { model: 'deepseek' } },
          },
        }],
        hasMore: false,
      },
    })
  })

  it('normalizes legacy session follow snapshots and entries for Session V3 clients', async () => {
    let eventHandler: ((event: EventPayload) => void) | undefined
    let streamId: string | undefined
    const client = {
      rpc: vi.fn(async (method: string, params: unknown) => {
        if (method === 'harness.remote.stream.open') {
          streamId = (params as { streamId: string }).streamId
          return { opened: true, streamId }
        }
        return { closed: true, streamId }
      }),
      onEvent: (handler: (event: EventPayload) => void) => {
        eventHandler = handler
        return () => undefined
      },
      onClose: () => () => undefined,
    } as unknown as RemoteClientCore
    const source = await new RemoteTypertGateway(client, 'legacy-to-v3').open(
      'session/follow',
      { args: {} },
      new AbortController().signal,
    )
    const iterator = source[Symbol.asyncIterator]()

    eventHandler?.({
      event: 'harness.remote.frame',
      data: {
        streamId,
        hasValue: true,
        value: {
          type: 'snapshot',
          header: { version: 2, id: 'session-1', createdAt: 1, isSeeded: false, agentPreset: 'code' },
          cursor: 4,
          records: [{
            type: 'event',
            event: {
              type: 'tool/code-dispatch',
              seq: 4,
              time: 2,
              surfaceOp: { op: 'replace', start: 1, end: 1 },
              data: {},
            },
          }],
          hasMore: false,
          projections: {},
        },
      },
    } as EventPayload)

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: 'snapshot',
        header: { version: 3, id: 'session-1', createdAt: 1, isSeeded: false, delegationDepth: 0, agentPreset: 'ptc' },
        cursor: 4,
        assistantStream: { revision: 0 },
        records: [{
          type: 'event',
          event: {
            type: 'tool/ptc-dispatch',
            seq: 4,
            time: 2,
            surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 },
            data: {},
          },
        }],
        hasMore: false,
        projections: {},
      },
    })

    eventHandler?.({
      event: 'harness.remote.stream.closed',
      data: { streamId, reason: 'completed' },
    } as EventPayload)
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it('marks Host stream failures for v0.1.2-alpha.2+ cross-bundle RemoteError detection', async () => {
    let eventHandler: ((event: EventPayload) => void) | undefined
    let streamId: string | undefined
    const client = {
      rpc: vi.fn(async (method: string, params: unknown) => {
        if (method === 'harness.remote.stream.open') {
          streamId = (params as { streamId: string }).streamId
          return { opened: true, streamId }
        }
        return { closed: true, streamId }
      }),
      onEvent: (handler: (event: EventPayload) => void) => {
        eventHandler = handler
        return () => undefined
      },
      onClose: () => () => undefined,
    } as unknown as RemoteClientCore
    const source = await new RemoteTypertGateway(client).open(
      'session/follow',
      { args: {} },
      new AbortController().signal,
    )
    const iterator = source[Symbol.asyncIterator]()

    eventHandler?.({
      event: 'harness.remote.stream.closed',
      data: {
        streamId,
        reason: 'failed',
        failure: {
          code: 'session/not-found',
          message: 'Session is unavailable.',
          details: { sessionId: 'session-1' },
        },
      },
    } as EventPayload)

    await expect(iterator.next()).rejects.toMatchObject({
      isDSHRemoteError: true,
      code: 'session/not-found',
      message: 'Session is unavailable.',
      details: { sessionId: 'session-1' },
    })
  })
})
