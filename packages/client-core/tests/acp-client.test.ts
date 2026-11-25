import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it, vi } from 'vitest'
import { ACP_HISTORY_RPC_TIMEOUT_MS, ACP_PROMPT_RPC_TIMEOUT_MS, AgentAcpClient } from '../src/acp-client.js'

describe('ACP image transfer', () => {
  it('requires archive capability and the exact OpenCode confirmation', async () => {
    const confirmed = { backend: 'opencode', sessionId: 'ses_1', archived: true }
    const rpc = vi.fn(async () => confirmed)
    await expect(new AgentAcpClient({ rpc } as never).archiveSession('ses_1', 'opencode')).rejects.toMatchObject({ code: 'OPENCODE_ARCHIVE_UNAVAILABLE' })
    expect(rpc).not.toHaveBeenCalled()
    const client = new AgentAcpClient({ rpc } as never, ['agent.acp.opencode.archive.v1'])
    await expect(client.archiveSession('ses_1', 'opencode')).resolves.toEqual(confirmed)
    expect(rpc).toHaveBeenCalledWith('agent.acp.call', { method: 'dsh/sessionArchive', params: { sessionId: 'ses_1', backend: 'opencode' } }, undefined, undefined)
    for (const response of [{ ...confirmed, archived: false }, { ...confirmed, sessionId: 'other' }, {}]) {
      rpc.mockResolvedValueOnce(response as typeof confirmed)
      await expect(client.archiveSession('ses_1', 'opencode')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    }
    await expect(client.archiveSession('ses_1', 'cursor')).rejects.toMatchObject({ code: 'OPENCODE_ARCHIVE_UNAVAILABLE' })
  })
  it('preserves authoritative ACP catalog/history failures instead of returning an empty successful baseline', async () => {
    const reads = [
      { backend: 'pi', kind: 'workspaces' }, { backend: 'pi', kind: 'catalog' },
      ...['pi', 'claude', 'opencode', 'antigravity'].map(backend => ({ backend, kind: 'history' })),
    ]
    await runScenarios(reads.flatMap(({ backend, kind }) => ['transport', 'malformed', 'empty', ...(kind === 'history' ? ['busy', 'oversized'] : [])].map(outcome => ({
      name: `${backend} ${kind}: ${outcome}`,
      run: async () => {
        const errorCode = outcome === 'busy' ? 'OPENCODE_HISTORY_BUSY' : outcome === 'oversized' ? 'ACP_HISTORY_TOO_LARGE' : 'DISCONNECTED'
        const rpc = vi.fn(async (method: string) => {
          if ((kind !== 'history' && method === 'agent.acp.call') || method === 'agent.acp.transfer.commit') {
            if (['transport', 'busy', 'oversized'].includes(outcome)) throw Object.assign(new Error('History unavailable'), { code: errorCode })
            const response = outcome === 'empty' ? kind === 'workspaces' ? [] : kind === 'catalog' ? { items: [] } : { events: [] } : { unexpected: [] }
            return kind !== 'history' ? response : { kind: 'inline', response }
          }
          return {}
        })
        const client = new AgentAcpClient({ rpc } as never)
        const read = kind === 'workspaces' ? client.listWorkspaces(backend) : kind === 'catalog' ? client.listSessions('/project', backend) : client.loadSessionHistory('saved', backend)
        if (outcome === 'empty') await expect(read).resolves.toEqual([])
        else await expect(read).rejects.toMatchObject({ code: outcome === 'malformed' ? 'INVALID_RESPONSE' : errorCode })
        if (kind === 'history') expect(rpc.mock.calls.at(-1)?.[0]).toBe('agent.acp.transfer.close')
      },
    }))))
  })
  it('model selection loads once when negotiated and keeps the legacy load fallback', async () => {
    for (const atomic of [false, true]) {
      const selected = { provider: 'antigravity', model: 'live-model', reasoningEffort: 'low' }
      const rpc = vi.fn(async (_method: string, params: any) => params.method === 'dsh/selectModel' ? { selected } : { sessionId: 'conversation' })
      const client = new AgentAcpClient({ rpc } as never, atomic ? ['agent.acp.antigravity.model-load.v1'] : [])
      expect(await client.selectModel('conversation', 'antigravity', selected)).toEqual(selected)
      expect(rpc.mock.calls.map(([, params]) => params.method)).toEqual(atomic ? ['dsh/selectModel'] : ['session/load', 'dsh/selectModel'])
    }
  })
  it('loads bounded chunked history through the independent ACP domain', async () => {
    let transferId = ''
    const response = JSON.stringify({ events: [{ type: 'image', data: 'A'.repeat(800_000) }] })
    const bytes = Buffer.from(response)
    const chunkBytes = 512 * 1024
    const rpc = vi.fn(async (method: string, params: any) => {
      if (method === 'agent.acp.transfer.open') transferId = params.transferId
      if (method === 'agent.acp.transfer.commit') return { kind: 'chunked', transferId, totalBytes: bytes.length, totalChunks: 2 }
      if (method === 'agent.acp.transfer.read') return { transferId, index: params.index, data: bytes.subarray(params.index * chunkBytes, (params.index + 1) * chunkBytes).toString('base64') }
      return {}
    })
    const client = new AgentAcpClient({ rpc } as never)
    expect(await client.loadSessionHistory('acp:remote', 'antigravity')).toEqual(JSON.parse(response).events)
    expect(rpc.mock.calls.every(([method]) => method.startsWith('agent.acp.'))).toBe(true)
    const request = rpc.mock.calls.find(([method]) => method === 'agent.acp.transfer.chunk')![1]
    expect(JSON.parse(Buffer.from(request.data, 'base64').toString())).toEqual({ method: 'dsh/sessionHistory', params: { sessionId: 'acp:remote', backend: 'antigravity' } })
    expect(rpc.mock.calls.at(-1)?.[0]).toBe('agent.acp.transfer.close')
  })

  it('transfers image prompts in ordered chunks and closes inline transfers', async () => {
    const rpc = vi.fn(async (method: string) => method === 'agent.acp.transfer.commit' ? { kind: 'inline', response: { accepted: true } } : {})
    const client = new AgentAcpClient({ rpc } as never)
    await client.prompt('agy-session', 'Inspect', undefined, [{ type: 'image', mimeType: 'image/png', data: 'A'.repeat(800_000) }], 'antigravity')
    const chunks = rpc.mock.calls.filter(([method]) => method === 'agent.acp.transfer.chunk') as unknown as Array<[string, { index: number; data: string }]>
    expect(chunks.map(([, chunk]) => chunk.index)).toEqual([0, 1])
    const envelope = JSON.parse(chunks.map(([, chunk]) => Buffer.from(chunk.data, 'base64').toString()).join(''))
    expect(envelope).toMatchObject({ method: 'session/prompt', params: { sessionId: 'agy-session', backend: 'antigravity', prompt: [{ type: 'text', text: 'Inspect' }, { type: 'image', mimeType: 'image/png' }] } })
    expect(rpc).toHaveBeenCalledWith('agent.acp.transfer.commit', expect.anything(), undefined, ACP_PROMPT_RPC_TIMEOUT_MS)
    expect(rpc.mock.calls.at(-1)?.[0]).toBe('agent.acp.transfer.close')
  })

  it('closes an aborted history transfer without reusing the aborted signal', async () => {
    const controller = new AbortController()
    let enterCommit!: () => void
    const enteredCommit = new Promise<void>(resolve => { enterCommit = resolve })
    const rpc = vi.fn(async (method: string, _params: unknown, signal?: AbortSignal) => {
      if (method !== 'agent.acp.transfer.commit') return {}
      enterCommit()
      return new Promise((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
      })
    })
    const client = new AgentAcpClient({ rpc } as never)
    const history = client.loadSessionHistory('saved', 'antigravity', controller.signal)
    const cancelled = expect(history).rejects.toMatchObject({ name: 'AbortError' })
    await enteredCommit
    controller.abort()
    await cancelled
    const transfer = rpc.mock.calls.find(([method]) => method === 'agent.acp.transfer.commit')?.[1]
    expect(rpc.mock.calls.at(-1)).toEqual(['agent.acp.transfer.close', transfer])
    expect(rpc.mock.calls.some(([method]) => method === 'agent.acp.transfer.read')).toBe(false)
  })

  it('releases failed or mismatched ACP response transfers', async () => {
    await runScenarios([
      {
        name: 'fails closed on a mismatched response chunk and releases the transfer',
        run: async () => {
          let transferId = ''
          const rpc = vi.fn(async (method: string, params: any) => {
            if (method === 'agent.acp.transfer.open') transferId = params.transferId
            if (method === 'agent.acp.transfer.commit')
              return { kind: 'chunked', transferId, totalBytes: 2, totalChunks: 1 }
            if (method === 'agent.acp.transfer.read')
              return { transferId: 'another-transfer', index: 0, data: 'e30=' }
            return {}
          })
          const client = new AgentAcpClient({ rpc } as never)
          await expect(
            client.transferCall('dsh/sessionHistory', { sessionId: 'agy-session' }),
          ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
          expect(rpc.mock.calls.at(-1)?.[0]).toBe('agent.acp.transfer.close')
        },
      },
      {
        name: 'closes an unfinished transfer when a chunk fails',
        run: async () => {
          const rpc = vi.fn(async (method: string) => {
            if (method === 'agent.acp.transfer.chunk') throw new Error('disconnected')
            return {}
          })
          const client = new AgentAcpClient({ rpc } as never)
          await expect(
            client.prompt(
              'agy-session',
              '',
              undefined,
              [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }],
              'antigravity',
            ),
          ).rejects.toThrow('disconnected')
          expect(rpc.mock.calls.at(-1)?.[0]).toBe('agent.acp.transfer.close')
        },
      },
    ])
  }, 10000)
})

describe('AgentAcpClient.openStream', () => {
  function createStreamCore(rpcImpl?: (method: string, params: unknown) => Promise<unknown>) {
    const eventHandlers = new Set<(event: { event: string; data: unknown }) => void>()
    const closeHandlers = new Set<(error?: Error) => void>()
    const rpc = vi.fn(async (method: string, params: unknown) => {
      if (rpcImpl) return rpcImpl(method, params)
      return { opened: true }
    })
    return {
      rpc,
      eventHandlers,
      closeHandlers,
      onEvent(handler: (event: { event: string; data: unknown }) => void) {
        eventHandlers.add(handler)
        return () => eventHandlers.delete(handler)
      },
      onClose(handler: (error?: Error) => void) {
        closeHandlers.add(handler)
        return () => closeHandlers.delete(handler)
      },
      emit(event: string, data: unknown) {
        for (const handler of eventHandlers) handler({ event, data })
      },
      drop(error?: Error) {
        for (const handler of closeHandlers) handler(error)
      },
    }
  }

  it('unsubscribes on stream.closed so reopened streams do not invoke stale onFrame', async () => {
    const core = createStreamCore()
    const client = new AgentAcpClient(core as never)
    const firstFrames: unknown[] = []
    const firstClosed: unknown[] = []
    const first = await client.openStream('ses-1', frame => firstFrames.push(frame), closed => firstClosed.push(closed))

    core.emit('agent.acp.frame', {
      streamId: first.streamId,
      frame: { method: 'session/update', params: { sessionId: 'ses-1', delta: 'a' } },
    })
    expect(firstFrames).toHaveLength(1)

    core.emit('agent.acp.stream.closed', { streamId: first.streamId, reason: 'completed' })
    expect(firstClosed).toEqual([{ streamId: first.streamId, reason: 'completed' }])
    expect(core.eventHandlers.size).toBe(0)
    expect(core.closeHandlers.size).toBe(0)

    const secondFrames: unknown[] = []
    const second = await client.openStream('ses-1', frame => secondFrames.push(frame))
    // Fallback sessionId-matched frame on reopened stream must not reach the first listener.
    core.emit('agent.acp.frame', {
      streamId: second.streamId,
      frame: { method: 'session/update', params: { sessionId: 'ses-1', delta: 'b' } },
    })
    expect(firstFrames).toHaveLength(1)
    expect(secondFrames).toHaveLength(1)
    await first.close()
    await second.close()
    expect(core.rpc.mock.calls.filter(([method]) => method === 'agent.acp.stream.close')).toHaveLength(1)
  })

  it('notifies peer-disconnected on core.onClose after open, and cleans up silently before open', async () => {
    await runScenarios([
      {
        name: 'after open: emits peer-disconnected once and unsubscribes',
        run: async () => {
          const core = createStreamCore()
          const client = new AgentAcpClient(core as never)
          const frames: unknown[] = []
          const closed: unknown[] = []
          const stream = await client.openStream('ses-1', frame => frames.push(frame), data => closed.push(data))

          core.drop(new Error('socket lost'))
          core.drop(new Error('socket lost again'))
          core.emit('agent.acp.frame', {
            streamId: stream.streamId,
            frame: { method: 'session/update', params: { sessionId: 'ses-1' } },
          })

          expect(closed).toEqual([{ streamId: stream.streamId, reason: 'peer-disconnected' }])
          expect(frames).toHaveLength(0)
          expect(core.eventHandlers.size).toBe(0)
          expect(core.closeHandlers.size).toBe(0)
        },
      },
      {
        name: 'before open settles: unsubscribes without calling onClosed',
        run: async () => {
          let rejectOpen!: (error: Error) => void
          const core = createStreamCore((method) => {
            if (method === 'agent.acp.stream.open') {
              return new Promise((_, reject) => { rejectOpen = reject })
            }
            return Promise.resolve({})
          })
          const client = new AgentAcpClient(core as never)
          const closed: unknown[] = []
          const pending = client.openStream('ses-1', () => undefined, data => closed.push(data))

          core.drop(new Error('transport closed'))
          rejectOpen(new Error('TRANSPORT_CLOSED'))
          await expect(pending).rejects.toThrow('TRANSPORT_CLOSED')
          expect(closed).toEqual([])
          expect(core.eventHandlers.size).toBe(0)
          expect(core.closeHandlers.size).toBe(0)
        },
      },
    ])
  })

  it('unsubscribes and closes remotely on post-open abort without fabricating onClosed, and makes close() idempotent', async () => {
    const core = createStreamCore()
    const client = new AgentAcpClient(core as never)
    const controller = new AbortController()
    const frames: unknown[] = []
    const closed: unknown[] = []

    const stream = await client.openStream(
      'ses-1',
      frame => frames.push(frame),
      data => closed.push(data),
      controller.signal,
    )

    controller.abort()
    await Promise.resolve()

    expect(closed).toEqual([])
    expect(core.eventHandlers.size).toBe(0)
    expect(core.closeHandlers.size).toBe(0)
    expect(core.rpc.mock.calls.filter(([method]) => method === 'agent.acp.stream.close')).toEqual([
      ['agent.acp.stream.close', { streamId: stream.streamId }],
    ])

    // Subsequent frame and redundant close() calls must be no-ops.
    core.emit('agent.acp.frame', {
      streamId: stream.streamId,
      frame: { method: 'session/update', params: { sessionId: 'ses-1' } },
    })
    await stream.close()
    await stream.close()
    expect(frames).toHaveLength(0)
    expect(core.rpc.mock.calls.filter(([method]) => method === 'agent.acp.stream.close')).toHaveLength(1)

    // Also verify standalone idempotent close() without abort.
    const second = await client.openStream('ses-2', () => undefined)
    await second.close()
    await second.close()
    expect(core.rpc.mock.calls.filter(([method, p]) => method === 'agent.acp.stream.close' && (p as { streamId: string }).streamId === second.streamId)).toHaveLength(1)
  })

  it('uses extended RPC timeouts for long session history transfers and session/load', async () => {
    const rpc = vi.fn(async (method: string) => (
      method === 'agent.acp.transfer.commit' ? { kind: 'inline', response: { events: [] } } : { sessionId: 'opc-1' }
    ))
    const client = new AgentAcpClient({ rpc } as never)
    await client.loadSessionDetails('opc-1', 'opencode')
    expect(rpc).toHaveBeenCalledWith('agent.acp.transfer.commit', expect.anything(), undefined, ACP_HISTORY_RPC_TIMEOUT_MS)

    await client.call('session/load', { sessionId: 'opc-1', backend: 'opencode' })
    expect(rpc).toHaveBeenCalledWith('agent.acp.call', { method: 'session/load', params: { sessionId: 'opc-1', backend: 'opencode' } }, undefined, ACP_HISTORY_RPC_TIMEOUT_MS)

    await client.call('session/new', { cwd: '/repo', backend: 'opencode' })
    expect(rpc).toHaveBeenCalledWith('agent.acp.call', { method: 'session/new', params: { cwd: '/repo', backend: 'opencode' } }, undefined, undefined)
  })

  it('defers premature stream.closed arriving before openStream resolves and guards core close before open', async () => {
    await runScenarios([
      {
        name: 'delivers replayed frames immediately and defers early stream.closed until after openStream resolves',
        run: async () => {
          let resolveOpen!: (value: unknown) => void
          let openedStreamId = ''
          const core = createStreamCore((method, params) => {
            if (method === 'agent.acp.stream.open') {
              openedStreamId = (params as { streamId: string }).streamId
              return new Promise(resolve => { resolveOpen = resolve })
            }
            return Promise.resolve({})
          })
          const client = new AgentAcpClient(core as never)
          const events: string[] = []
          const closed: unknown[] = []
          const pending = client.openStream(
            'ses-1',
            frame => events.push(`frame:${String((frame.frame.params as { delta?: unknown }).delta)}`),
            data => {
              events.push(`closed:${data.reason}:${streamHandle.streamId}`)
              closed.push(data)
            },
          )
          // Host replays frames then emits stream.closed before the open RPC response settles.
          core.emit('agent.acp.frame', {
            streamId: openedStreamId,
            frame: { method: 'session/update', params: { sessionId: 'ses-1', delta: 'prompt_failed' } },
          })
          core.emit('agent.acp.stream.closed', { streamId: openedStreamId, reason: 'failed' })
          expect(events).toEqual(['frame:prompt_failed'])
          expect(closed).toEqual([])

          resolveOpen({ opened: true })
          const streamHandle = await pending
          expect(closed).toEqual([])
          await Promise.resolve()
          expect(events).toEqual(['frame:prompt_failed', `closed:failed:${streamHandle.streamId}`])
          expect(closed).toEqual([{ streamId: streamHandle.streamId, reason: 'failed' }])
          expect(core.eventHandlers.size).toBe(0)
          expect(core.closeHandlers.size).toBe(0)
        },
      },
      {
        name: 'suppresses deferred early stream.closed when caller closes stream immediately after open resolves',
        run: async () => {
          let resolveOpen!: (value: unknown) => void
          let openedStreamId = ''
          const core = createStreamCore((method, params) => {
            if (method === 'agent.acp.stream.open') {
              openedStreamId = (params as { streamId: string }).streamId
              return new Promise(resolve => { resolveOpen = resolve })
            }
            return Promise.resolve({})
          })
          const client = new AgentAcpClient(core as never)
          const closed: unknown[] = []
          const pending = client.openStream('ses-1', () => undefined, data => closed.push(data))
          core.emit('agent.acp.stream.closed', { streamId: openedStreamId, reason: 'failed' })
          resolveOpen({ opened: true })
          const stream = await pending
          await stream.close()
          await Promise.resolve()
          expect(closed).toEqual([])
          expect(core.rpc.mock.calls.filter(([method]) => method === 'agent.acp.stream.close')).toHaveLength(0)
        },
      },
      {
        name: 'suppresses deferred early stream.closed when signal aborts immediately after open resolves',
        run: async () => {
          let resolveOpen!: (value: unknown) => void
          let openedStreamId = ''
          const controller = new AbortController()
          const core = createStreamCore((method, params) => {
            if (method === 'agent.acp.stream.open') {
              openedStreamId = (params as { streamId: string }).streamId
              return new Promise(resolve => { resolveOpen = resolve })
            }
            return Promise.resolve({})
          })
          const client = new AgentAcpClient(core as never)
          const closed: unknown[] = []
          const pending = client.openStream('ses-1', () => undefined, data => closed.push(data), controller.signal)
          core.emit('agent.acp.stream.closed', { streamId: openedStreamId, reason: 'failed' })
          resolveOpen({ opened: true })
          await pending
          controller.abort()
          await Promise.resolve()
          await Promise.resolve()
          expect(closed).toEqual([])
        },
      },
      {
        name: 'isolates a throwing deferred onClosed callback without causing an unhandled error',
        run: async () => {
          const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
          try {
            let resolveOpen!: (value: unknown) => void
            let openedStreamId = ''
            const core = createStreamCore((method, params) => {
              if (method === 'agent.acp.stream.open') {
                openedStreamId = (params as { streamId: string }).streamId
                return new Promise(resolve => { resolveOpen = resolve })
              }
              return Promise.resolve({})
            })
            const client = new AgentAcpClient(core as never)
            const pending = client.openStream('ses-1', () => undefined, () => {
              throw new TypeError('callback crashed')
            })
            core.emit('agent.acp.stream.closed', { streamId: openedStreamId, reason: 'failed' })
            resolveOpen({ opened: true })
            await pending
            await Promise.resolve()
            await Promise.resolve()
            expect(errorSpy).toHaveBeenCalledWith('[dsh-remote] event handler error:', 'TypeError')
          } finally {
            errorSpy.mockRestore()
          }
        },
      },
      {
        name: 'does not invoke deferred onClosed when stream.open RPC rejects',
        run: async () => {
          let rejectOpen!: (error: Error) => void
          let openedStreamId = ''
          const core = createStreamCore((method, params) => {
            if (method === 'agent.acp.stream.open') {
              openedStreamId = (params as { streamId: string }).streamId
              return new Promise((_, reject) => { rejectOpen = reject })
            }
            return Promise.resolve({})
          })
          const client = new AgentAcpClient(core as never)
          const closed: unknown[] = []
          const pending = client.openStream('ses-1', () => undefined, data => closed.push(data))
          core.emit('agent.acp.stream.closed', { streamId: openedStreamId, reason: 'failed' })
          rejectOpen(new Error('OPEN_FAILED'))
          await expect(pending).rejects.toThrow('OPEN_FAILED')
          await Promise.resolve()
          expect(closed).toEqual([])
        },
      },
      {
        name: 'rejects with TRANSPORT_CLOSED if core closed before openStream RPC resolved',
        run: async () => {
          let resolveOpen!: (value: unknown) => void
          const core = createStreamCore(method => (
            method === 'agent.acp.stream.open'
              ? new Promise(resolve => { resolveOpen = resolve })
              : Promise.resolve({})
          ))
          const client = new AgentAcpClient(core as never)
          const closed: unknown[] = []
          const pending = client.openStream('ses-1', () => undefined, data => closed.push(data))
          core.drop(new Error('socket dropped'))
          resolveOpen({ opened: true })
          await expect(pending).rejects.toMatchObject({ code: 'TRANSPORT_CLOSED' })
          await Promise.resolve()
          expect(closed).toEqual([])
        },
      },
    ])
  })
})
