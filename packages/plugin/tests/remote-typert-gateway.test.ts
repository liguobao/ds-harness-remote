import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { RemoteClientError, type RemoteClientCore } from '@dsh-remote/client-core'
import type { EventPayload } from '@dsh-remote/protocol'
import { describe, expect, it, vi } from 'vitest'
import { RemoteTypertGateway } from '../src/remote-typert-gateway.js'
import { RemoteSessionHistoryCache } from '../src/session-history-cache.js'

describe('RemoteTypertGateway', () => {
  it('marks legacy projection cuts while preserving migration-required and missing results', async () => {
    await runScenarios([
      { name: 'legacy exact cut', value: { asOfSeq: 7, values: { title: 'fixture' } }, expected: { kind: 'sequenced', asOfSeq: 7, values: { title: 'fixture' } } },
      { name: 'migration hint', value: { kind: 'migration-required', values: { title: 'fixture' } }, expected: { kind: 'migration-required', values: { title: 'fixture' } } },
      { name: 'absent', value: null, expected: null },
    ].map(({ name, value, expected }) => ({ name, run: async () => {
      const remote = new RemoteTypertGateway({ rpc: vi.fn(async () => ({ ok: true, value })) } as unknown as RemoteClientCore)
      await expect(remote.dispatch('session/projections', { args: { request: { sessionId: 's1' } } }, new AbortController().signal))
        .resolves.toEqual({ ok: true, value: expected })
    } })))
  })

  it('preserves object-shaped Typert Remote arguments', async () => {
    await runScenarios([
      {
        name: 'preserves the plain-object args required by the current Typert Remote contract',
        run: async () => {
          const rpc = vi.fn(async (_method: string, params: any) => {
            expect(params).toMatchObject({
              endpoint: 'settings/mutate',
              payload: {
                args: {
                  ns: 'llm-pi-ai',
                  ops: [{ op: 'set', path: ['profiles', 'custom'], value: { model: 'm' } }],
                  expectedRevision: 4,
                },
              },
            })
            return { ok: true, value: { revision: 5 } }
          })
          const client = { rpc } as unknown as RemoteClientCore
          await expect(
            new RemoteTypertGateway(client).dispatch(
              'settings/mutate',
              {
                args: {
                  ns: 'llm-pi-ai',
                  ops: [{ op: 'set', path: ['profiles', 'custom'], value: { model: 'm' } }],
                  expectedRevision: 4,
                },
              },
              new AbortController().signal,
            ),
          ).resolves.toEqual({ ok: true, value: { revision: 5 } })
        },
      },
      {
        name: 'preserves object-shaped discovery arguments unchanged',
        run: async () => {
          const rpc = vi.fn(async (_method: string, params: any) => {
            expect(params.payload.args).toEqual({
              settingsNs: 'llm-pi-ai',
              provider: 'custom',
              baseURL: 'https://gateway.example/v1',
            })
            return { ok: true, value: { models: [] } }
          })
          const client = { rpc } as unknown as RemoteClientCore
          await new RemoteTypertGateway(client).dispatch(
            'llm/discoverModels',
            {
              args: { settingsNs: 'llm-pi-ai', provider: 'custom', baseURL: 'https://gateway.example/v1' },
            },
            new AbortController().signal,
          )
        },
      },
      {
        name: 'keeps an empty provider-directory args object instead of sending an array',
        run: async () => {
          const rpc = vi.fn(async (_method: string, params: any) => {
            expect(params).toMatchObject({ endpoint: 'llm/listProviders', payload: { args: {} } })
            return { ok: true, value: [] }
          })
          const client = { rpc } as unknown as RemoteClientCore
          await expect(
            new RemoteTypertGateway(client).dispatch(
              'llm/listProviders',
              { args: {} },
              new AbortController().signal,
            ),
          ).resolves.toEqual({ ok: true, value: [] })
        },
      },
    ])
  }, 15000)

  it('does not resubmit an executed command when its response is too large', async () => {
    const error = Object.assign(new Error('response too large'), { code: 'RESPONSE_TOO_LARGE' })
    const rpc = vi.fn().mockRejectedValue(error)
    const client = { rpc } as unknown as RemoteClientCore
    await expect(new RemoteTypertGateway(client).dispatch(
      'commands/execute', { args: {} }, new AbortController().signal,
    )).rejects.toBe(error)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

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

  it('restores binary workspace preview fields for the native Client API codec', async () => {
    await runScenarios([
      {
        endpoint: 'workspaceFiles/readBytes',
        args: { path: '/tmp/image.png', range: { offset: 0, length: 3 } },
        data: 'AP8Q',
        expected: [0, 255, 16],
      },
      {
        endpoint: 'officeToPdf/render',
        args: { path: '/tmp/report.docx' },
        data: 'JVBE',
        expected: [37, 80, 68],
      },
      {
        endpoint: 'officeKit/render',
        args: { path: '/tmp/report.docx' },
        data: 'JVBE',
        expected: [37, 80, 68],
      },
    ].map(({ endpoint, args, data, expected }) => ({
      name: endpoint,
      run: async () => {
        const rpc = vi.fn(async () => ({
          ok: true,
          value: {
            absolutePath: args.path,
            version: 'v1',
            bytes: expected.length,
            offset: 0,
            data,
            eof: true,
          },
        }))
        const client = { rpc } as unknown as RemoteClientCore

        const result = await new RemoteTypertGateway(client).dispatch(
          endpoint,
          { args },
          new AbortController().signal,
        )
        expect(result).toMatchObject({ ok: true, value: { data: expect.any(Uint8Array) } })
        expect(Array.from((result as { ok: true; value: { data: Uint8Array } }).value.data)).toEqual(expected)
      },
    })))
  })

  it('keeps welcome acknowledgements local on legacy Hosts', async () => {
    await runScenarios([
      {
        name: 'keeps the welcome acknowledgement local for pre-0.1.7 Hosts',
        run: async () => {
          const rpc = vi.fn(async (method: string): Promise<any> => {
            if (method === 'harness.remote.call') {
              return {
                ok: false,
                error: { code: 'settings/unknown-field', message: 'unknown field', details: {} },
              }
            }
            return { accepted: true }
          })
          const client = { rpc } as unknown as RemoteClientCore
          const gateway = new RemoteTypertGateway(client, undefined, '0.1.6-alpha.2')
          // The describe result is cached so a rejected old Host write can be folded
          // into the same namespace view the settings UI already loaded.
          rpc.mockImplementationOnce(async () => ({
            ok: true,
            value: {
              writable: true,
              namespaces: [{ ns: 'ui-settings-general', value: {}, revision: 1 }],
            },
          }))
          await gateway.dispatch('settings/describe', { args: {} }, new AbortController().signal)
          await expect(
            gateway.dispatch(
              'settings/mutate',
              {
                args: {
                  ns: 'ui-settings-general',
                  ops: [{ op: 'set', path: ['welcomeNoticeVersion'], value: '2026-08-13.1' }],
                },
              },
              new AbortController().signal,
            ),
          ).resolves.toMatchObject({
            ok: true,
            value: {
              namespaces: [{ ns: 'ui-settings-general', value: { welcomeNoticeVersion: '2026-08-13.1' } }],
            },
          })
        },
      },
      {
        name: 'acknowledges the welcome notice when the legacy Host has no describe snapshot',
        run: async () => {
          const rpc = vi.fn(
            async (): Promise<any> => ({
              ok: false,
              error: { code: 'settings/unknown-field', message: 'unknown field', details: {} },
            }),
          )
          const gateway = new RemoteTypertGateway(
            { rpc } as unknown as RemoteClientCore,
            undefined,
            '0.1.6-alpha.2',
          )
          await expect(
            gateway.dispatch(
              'settings/mutate',
              {
                args: {
                  ns: 'ui-settings-general',
                  ops: [{ op: 'set', path: ['welcomeNoticeVersion'], value: '2026-08-13.1' }],
                },
              },
              new AbortController().signal,
            ),
          ).resolves.toMatchObject({
            ok: true,
            value: { namespaces: [] },
          })
        },
      },
    ])
  }, 10000)

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

  it('normalizes legacy session pages and streams for Session V3', async () => {
    await runScenarios([
      {
        name: 'normalizes legacy session pages for Session V3 clients',
        run: async () => {
          const client = {
            rpc: vi.fn(async () => ({
              ok: true,
              value: {
                records: [
                  {
                    type: 'event',
                    event: {
                      type: 'request/header',
                      seq: 2,
                      time: 123,
                      data: {
                        header: { system: 'old prompt', tools: [], adapterDefaults: {}, model: 'deepseek' },
                      },
                    },
                  },
                ],
                hasMore: false,
              },
            })),
          } as unknown as RemoteClientCore

          await expect(
            new RemoteTypertGateway(client, 'legacy-to-v3').dispatch(
              'session/page',
              { args: {} },
              new AbortController().signal,
            ),
          ).resolves.toEqual({
            ok: true,
            value: {
              records: [
                {
                  type: 'event',
                  event: {
                    type: 'request/header',
                    seq: 2,
                    time: 123,
                    data: { header: { model: 'deepseek' } },
                  },
                },
              ],
              hasMore: false,
            },
          })
        },
      },
      {
        name: 'normalizes legacy session follow snapshots and entries for Session V3 clients',
        run: async () => {
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
                records: [
                  {
                    type: 'event',
                    event: {
                      type: 'tool/code-dispatch',
                      seq: 4,
                      time: 2,
                      surfaceOp: { op: 'replace', start: 1, end: 1 },
                      data: {},
                    },
                  },
                ],
                hasMore: false,
                projections: {},
              },
            },
          } as EventPayload)

          await expect(iterator.next()).resolves.toEqual({
            done: false,
            value: {
              type: 'snapshot',
              header: {
                version: 3,
                id: 'session-1',
                createdAt: 1,
                isSeeded: false,
                delegationDepth: 0,
                agentPreset: 'ptc',
              },
              cursor: 4,
              assistantStream: { revision: 0 },
              records: [
                {
                  type: 'event',
                  event: {
                    type: 'tool/ptc-dispatch',
                    seq: 4,
                    time: 2,
                    surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 },
                    data: {},
                  },
                },
              ],
              hasMore: false,
              projections: {},
            },
          })

          eventHandler?.({
            event: 'harness.remote.stream.closed',
            data: { streamId, reason: 'completed' },
          } as EventPayload)
          await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
        },
      },
      {
        name: 'removes legacy assistant message source refs for Session V3 clients',
        run: async () => {
          const client = {
            rpc: vi.fn(async () => ({
              ok: true,
              value: {
                records: [
                  {
                    type: 'event',
                    event: {
                      type: 'assistant/message',
                      seq: 7,
                      time: 321,
                      sourceEventSeqs: [3, 4],
                      surfaceOp: 'append',
                      data: { message: { id: 'assistant-1', role: 'assistant', content: [] } },
                    },
                  },
                ],
                hasMore: false,
              },
            })),
          } as unknown as RemoteClientCore

          await expect(
            new RemoteTypertGateway(client, 'legacy-to-v3').dispatch(
              'session/page',
              { args: {} },
              new AbortController().signal,
            ),
          ).resolves.toEqual({
            ok: true,
            value: {
              records: [
                {
                  type: 'event',
                  event: {
                    type: 'assistant/message',
                    seq: 7,
                    time: 321,
                    surfaceOp: 'append',
                    data: { message: { id: 'assistant-1', role: 'assistant', content: [] } },
                  },
                },
              ],
              hasMore: false,
            },
          })
        },
      },
      {
        name: 'fills legacy session history gaps with ignorable records for Session V3 clients',
        run: async () => {
          const client = {
            rpc: vi.fn(async () => ({
              ok: true,
              value: {
                records: [
                  {
                    type: 'event',
                    event: {
                      type: 'user/message',
                      seq: 2,
                      time: 300,
                      surfaceOp: 'append',
                      data: { id: 'user-1', role: 'user', content: [] },
                    },
                  },
                  {
                    type: 'projection',
                    key: 'todos',
                    seq: 2,
                    value: null,
                  },
                  {
                    type: 'event',
                    event: {
                      type: 'assistant/message',
                      seq: 5,
                      time: 500,
                      sourceEventSeqs: [2],
                      surfaceOp: 'append',
                      data: { message: { id: 'assistant-1', role: 'assistant', content: [] } },
                    },
                  },
                ],
                hasMore: true,
              },
            })),
          } as unknown as RemoteClientCore

          await expect(
            new RemoteTypertGateway(client, 'legacy-to-v3').dispatch(
              'session/page',
              { args: {} },
              new AbortController().signal,
            ),
          ).resolves.toEqual({
            ok: true,
            value: {
              records: [
                {
                  type: 'event',
                  event: {
                    type: 'user/message',
                    seq: 2,
                    time: 300,
                    surfaceOp: 'append',
                    data: { id: 'user-1', role: 'user', content: [] },
                  },
                },
                {
                  type: 'event',
                  event: {
                    type: 'legacy/session-gap',
                    seq: 3,
                    time: 500,
                    ignorable: true,
                    data: {},
                  },
                },
                {
                  type: 'event',
                  event: {
                    type: 'legacy/session-gap',
                    seq: 4,
                    time: 500,
                    ignorable: true,
                    data: {},
                  },
                },
                {
                  type: 'event',
                  event: {
                    type: 'assistant/message',
                    seq: 5,
                    time: 500,
                    surfaceOp: 'append',
                    data: { message: { id: 'assistant-1', role: 'assistant', content: [] } },
                  },
                },
              ],
              hasMore: true,
            },
          })
        },
      },
    ])
  }, 20000)

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

  it('reuses cached session follow snapshots, delta events, and unary pages across project switches and transient failures', async () => {
    const handlers = new Set<(event: EventPayload) => void>()
    const openedStreams: string[] = []
    let failRemote = false
    const client = {
      rpc: vi.fn(async (method: string, params: unknown) => {
        if (method === 'harness.transport.describe') return { capabilities: [] }
        if (method === 'harness.remote.stream.open') {
          if (failRemote) throw new RemoteClientError('RPC_TIMEOUT', 'stream open timed out')
          const id = (params as { streamId: string }).streamId
          openedStreams.push(id)
          return { opened: true, streamId: id }
        }
        if (method === 'harness.remote.call') {
          if (failRemote) throw new RemoteClientError('RPC_TIMEOUT', 'remote call timed out')
          const { endpoint } = params as { endpoint: string }
          if (endpoint === 'session/projections') {
            return { ok: true, value: { kind: 'cached', asOfSeq: 1, values: { title: 'Project A' } } }
          }
          if (endpoint === 'session/prompt') {
            return { ok: true, value: { accepted: true } }
          }
        }
        return { closed: true }
      }),
      onEvent: (handler: (event: EventPayload) => void) => {
        handlers.add(handler)
        return () => handlers.delete(handler)
      },
      onClose: () => () => undefined,
    } as unknown as RemoteClientCore
    const emit = (streamId: string, value: unknown) => {
      for (const handler of handlers) {
        handler({ event: 'harness.remote.frame', data: { streamId, hasValue: true, value } } as EventPayload)
      }
    }
    const cache = new RemoteSessionHistoryCache()
    const firstGateway = new RemoteTypertGateway(client, undefined, undefined, false, cache)
    const signal = new AbortController().signal
    const followPayload = { args: { request: { address: { kind: 'session', sessionId: 'session-a' }, maxMessages: 50 } } }

    const firstStream = await firstGateway.open('session/follow', followPayload, signal)
    const firstIterator = firstStream[Symbol.asyncIterator]()
    const record0 = { type: 'event', event: { seq: 0, time: 1, type: 'user/message', data: { text: 'first' } } }
    const record1 = { type: 'event', event: { seq: 1, time: 2, type: 'assistant/message', data: { text: 'reply' } } }
    emit(openedStreams[0]!, {
      type: 'snapshot',
      header: { id: 'session-a', version: 3 },
      cursor: 0,
      records: [record0],
      hasMore: false,
      projections: { kind: 'sequenced', asOfSeq: 0, values: { title: 'Project A' } },
      assistantStream: { revision: 4 },
    })
    emit(openedStreams[0]!, record1)
    await expect(firstIterator.next()).resolves.toMatchObject({ value: { type: 'snapshot', cursor: 0 } })
    await expect(firstIterator.next()).resolves.toEqual({ done: false, value: record1 })
    await firstIterator.return?.()

    // Switching back to Project A on a new gateway sharing the Host cache serves
    // the cached snapshot immediately (before upstream responds) and appends only delta records.
    const secondGateway = new RemoteTypertGateway(client, undefined, undefined, false, cache)
    const pagePayload = { args: { request: { address: { kind: 'session', sessionId: 'session-a' }, throughSeq: 1, maxMessages: 10 } } }
    await expect(secondGateway.dispatch('session/page', pagePayload, signal)).resolves.toEqual({
      ok: true,
      value: { records: [record0, record1], hasMore: false, cursor: 1 },
    })
    await expect(secondGateway.dispatch('session/projections', { args: { request: { sessionId: 'session-a' } } }, signal)).resolves.toMatchObject({
      ok: true,
      value: { values: { title: 'Project A' } },
    })
    await expect(secondGateway.dispatch('session/projections', { args: { request: { sessionId: 'session-a' } } }, signal)).resolves.toMatchObject({
      ok: true,
      value: { values: { title: 'Project A' } },
    })
    expect((client.rpc as ReturnType<typeof vi.fn>).mock.calls.filter(call => call[0] === 'harness.remote.call')).toHaveLength(1)

    const secondStream = await secondGateway.open('session/follow', followPayload, signal)
    const secondIterator = secondStream[Symbol.asyncIterator]()
    await expect(secondIterator.next()).resolves.toMatchObject({
      value: {
        type: 'snapshot',
        cursor: 1,
        records: [record0, record1],
        assistantStream: { revision: 0 },
      },
    })
    const record2 = { type: 'event', event: { seq: 2, time: 3, type: 'assistant/message', data: { text: 'delta' } } }
    emit(openedStreams[1]!, {
      type: 'snapshot',
      header: { id: 'session-a', version: 3 },
      cursor: 2,
      records: [record0, record1, record2],
      hasMore: false,
      assistantStream: { revision: 0 },
    })
    await expect(secondIterator.next()).resolves.toEqual({ done: false, value: record2 })
    await secondIterator.return?.()

    // Fallback to cached history on a new connection when remote calls time out.
    failRemote = true
    const reconnectedClient = { ...client, rpc: client.rpc } as unknown as RemoteClientCore
    const fallbackGateway = new RemoteTypertGateway(reconnectedClient, undefined, undefined, false, cache)
    const fallbackStream = await fallbackGateway.open('session/follow', followPayload, signal)
    const fallbackIterator = fallbackStream[Symbol.asyncIterator]()
    await expect(fallbackIterator.next()).resolves.toMatchObject({
      value: { type: 'snapshot', cursor: 2, records: [record0, record1, record2] },
    })
    await expect(fallbackGateway.dispatch('session/history', { args: { request: { sessionId: 'session-a' } } }, signal)).resolves.toMatchObject({
      ok: true,
      value: { throughSeq: 2, records: [record0, record1, record2] },
    })
  })

  it('applies extended timeout to speech/transcribe and keeps defaults for speech/prepare and speech/catalog', async () => {
    await runScenarios([
      {
        name: 'direct speech/transcribe passes 3-minute timeout',
        run: async () => {
          const rpc = vi.fn(async () => ({ ok: true, value: { text: 'hello' } }))
          const signal = new AbortController().signal
          const payload = { args: { request: { audioBase64: 'UklGRg==' } } }
          await expect(
            new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore).dispatch('speech/transcribe', payload, signal),
          ).resolves.toEqual({ ok: true, value: { text: 'hello' } })
          expect(rpc).toHaveBeenCalledWith(
            'harness.remote.call',
            { endpoint: 'speech/transcribe', payload },
            signal,
            { timeoutMs: 180_000 },
          )
        },
      },
      {
        name: 'transferred speech/transcribe large request passes 3-minute timeout to commit',
        run: async () => {
          const rpc = vi.fn(async (method: string) => {
            if (method === 'harness.remote.call') {
              throw Object.assign(new Error('too large'), { code: 'RESPONSE_TOO_LARGE' })
            }
            if (method === 'harness.remote.transfer.commit') {
              return { kind: 'inline', response: { ok: true, value: { text: 'hello' } } }
            }
            if (method === 'harness.remote.transfer.close') return { closed: true }
            return { accepted: true }
          })
          const signal = new AbortController().signal
          const payload = { args: { request: { audioBase64: 'A'.repeat(2 * 1024 * 1024) } } }
          await expect(
            new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore).dispatch('speech/transcribe', payload, signal),
          ).resolves.toEqual({ ok: true, value: { text: 'hello' } })
          expect(rpc).not.toHaveBeenCalledWith(
            'harness.remote.call',
            { endpoint: 'speech/transcribe', payload },
            signal,
            { timeoutMs: 180_000 },
          )
          expect(rpc).toHaveBeenCalledWith(
            'harness.remote.transfer.commit',
            { transferId: expect.any(String) },
            signal,
            { timeoutMs: 180_000 },
          )
        },
      },
      {
        name: 'speech/prepare and speech/catalog keep default 3-argument rpc call',
        run: async () => {
          const rpc = vi.fn(async () => ({ ok: true }))
          const signal = new AbortController().signal
          const gateway = new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore)
          await expect(gateway.dispatch('speech/prepare', { args: { providerId: 'sensevoice' } }, signal))
            .resolves.toEqual({ ok: true })
          expect(rpc.mock.calls[0]).toEqual([
            'harness.remote.call',
            { endpoint: 'speech/prepare', payload: { args: { providerId: 'sensevoice' } } },
            signal,
          ])
          await expect(gateway.dispatch('speech/catalog', { args: {} }, signal))
            .resolves.toEqual({ ok: true })
          expect(rpc.mock.calls[1]).toEqual([
            'harness.remote.call',
            { endpoint: 'speech/catalog', payload: { args: {} } },
            signal,
          ])
        },
      },
      {
        name: 'oversized speech/transcribe switches to harness.remote.transfer.* and passes 3-minute timeout to commit',
        run: async () => {
          const methods: string[] = []
          const rpc = vi.fn(async (method: string) => {
            methods.push(method)
            if (method === 'harness.remote.transfer.commit') {
              return { kind: 'inline', response: { ok: true, value: { text: 'long audio' } } }
            }
            if (method === 'harness.remote.transfer.close') return { closed: true }
            return { accepted: true }
          })
          const signal = new AbortController().signal
          const audioBase64 = 'A'.repeat(2 * 1024 * 1024 + 64)
          await expect(
            new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore).dispatch(
              'speech/transcribe',
              { args: { request: { audioBase64 } } },
              signal,
            ),
          ).resolves.toEqual({ ok: true, value: { text: 'long audio' } })
          expect(methods).not.toContain('harness.remote.call')
          expect(methods[0]).toBe('harness.remote.transfer.open')
          expect(methods.filter(method => method === 'harness.remote.transfer.chunk').length).toBeGreaterThan(1)
          const commitCall = rpc.mock.calls.find(call => call[0] === 'harness.remote.transfer.commit')
          expect(commitCall).toEqual([
            'harness.remote.transfer.commit',
            { transferId: expect.any(String) },
            signal,
            { timeoutMs: 180_000 },
          ])
          expect(methods.at(-1)).toBe('harness.remote.transfer.close')
        },
      },
    ])
  })
})
