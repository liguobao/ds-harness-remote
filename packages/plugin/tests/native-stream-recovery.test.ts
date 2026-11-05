import { RemoteSnapshotStream, RemoteStream, RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import { RemoteClientError, type RemoteClientCore } from '@dsh-remote/client-core'
import type { EventPayload } from '@dsh-remote/protocol'
import { describe, expect, it, vi } from 'vitest'
import { RemoteTypertGateway } from '../src/remote-typert-gateway.js'

type Frame = { type: 'baseline'; items: string[] } | { type: 'upsert'; item: string }

function carrier() {
  const events = new Set<(event: EventPayload) => void>()
  const closes = new Set<() => void>()
  let streamId = ''
  const client = {
    rpc: vi.fn(async (method: string, params: any) => {
      if (method === 'harness.transport.describe') return { capabilities: [] }
      if (method === 'harness.remote.stream.open') streamId = params.streamId
      return {}
    }),
    onEvent: (handler: (event: EventPayload) => void) => { events.add(handler); return () => { events.delete(handler) } },
    onClose: (handler: () => void) => { closes.add(handler); return () => { closes.delete(handler) } },
  }
  return {
    client: client as unknown as RemoteClientCore,
    events, closes,
    opened: () => streamId !== '',
    frame: (value: Frame) => { for (const handler of events) handler({ event: 'harness.remote.frame', data: { streamId, hasValue: true, value } } as EventPayload) },
    drop: () => { for (const handler of [...closes]) handler() },
    fail: () => { for (const handler of events) handler({ event: 'harness.remote.stream.closed', data: { streamId, reason: 'failed', failure: { code: 'permission/denied', message: 'denied', details: {} } } } as EventPayload) },
  }
}

describe('native metadata subscription recovery', () => {
  it('keeps the native snapshot consumer alive until carrier replacement, then accepts new workspaces', async () => {
    const first = carrier(), second = carrier()
    let gateway = new RemoteTypertGateway(first.client, undefined, undefined, true)
    const failed = vi.fn()
    let visible: string[] = []
    const stream = new RemoteStream<Frame>({ generation: { getSnapshot: () => undefined, subscribe: () => () => {} } }, {
      name: 'Workspace state stream',
      open: async function* (signal) { yield* await gateway.open('workspace/follow', { args: {} }, signal) as AsyncIterable<Frame> },
      ended: () => new RemoteStreamCarrierError('workspace stream ended'),
    })
    const snapshot = new RemoteSnapshotStream<Extract<Frame, { type: 'baseline' }>, Extract<Frame, { type: 'upsert' }>>(stream, {
      name: 'Workspace state stream',
      isSnapshot: (frame): frame is Extract<Frame, { type: 'baseline' }> => frame.type === 'baseline',
      replace: frame => { visible = [...frame.items] },
      update: frame => { visible.push(frame.item) },
      failed,
    })
    snapshot.start()
    try {
      await vi.waitFor(() => expect(first.opened()).toBe(true))
      first.frame({ type: 'baseline', items: ['existing'] })
      await vi.waitFor(() => expect(visible).toEqual(['existing']))
      first.drop()
      await new Promise(resolve => setTimeout(resolve, 20))
      // A wire error kills RemoteSnapshotStream permanently; restart cannot revive it.
      expect(failed).not.toHaveBeenCalled()
      expect(visible).toEqual(['existing'])
      gateway = new RemoteTypertGateway(second.client, undefined, undefined, true)
      snapshot.restart() // Native carrier reset after fresh authentication is ready.
      await vi.waitFor(() => expect(second.opened()).toBe(true))
      second.frame({ type: 'baseline', items: ['existing', 'created-offline'] })
      second.frame({ type: 'upsert', item: 'created-after-recovery' })
      await vi.waitFor(() => expect(visible).toEqual(['existing', 'created-offline', 'created-after-recovery']))
      expect(failed).not.toHaveBeenCalled()
    } finally { await snapshot.dispose() }
    expect(first.events.size + first.closes.size + second.events.size + second.closes.size).toBe(0)
  })

  it('does not defer business refusals or one-shot gateway transport failures', async () => {
    const business = carrier(), query = carrier()
    const signal = new AbortController().signal
    const refused = (await new RemoteTypertGateway(business.client, undefined, undefined, true).open('workspace/follow', { args: {} }, signal))[Symbol.asyncIterator]()
    const refusedRead = refused.next()
    business.fail()
    business.drop()
    await expect(refusedRead).rejects.toMatchObject({ code: 'permission/denied' })
    const once = (await new RemoteTypertGateway(query.client).open('workspace/follow', { args: {} }, signal))[Symbol.asyncIterator]()
    const read = once.next()
    query.drop()
    await expect(read).rejects.toBeInstanceOf(RemoteClientError)
    expect(query.events.size + query.closes.size + business.events.size + business.closes.size).toBe(0)
  })

  it.each(['describe', 'open'] as const)('releases an interrupted %s on caller cancellation without reopening it', async phase => {
    const f = carrier()
    const lifetime = new AbortController()
    const original = f.client.rpc.bind(f.client)
    let rejectPending!: (error: Error) => void
    vi.spyOn(f.client, 'rpc').mockImplementation((method, params, signal) => {
      if (method === `harness.${phase === 'describe' ? 'transport.describe' : 'remote.stream.open'}`) {
        return new Promise((_resolve, reject) => { rejectPending = reject })
      }
      return original(method, params, signal)
    })
    const settled = vi.fn()
    const opening = new RemoteTypertGateway(f.client, undefined, undefined, true)
      .open('workspace/follow', { args: {} }, lifetime.signal).catch(error => { settled(); throw error })
    const released = expect(opening).rejects.toMatchObject({ code: 'TRANSPORT_CLOSED' })
    await vi.waitFor(() => expect(rejectPending).toBeTypeOf('function'))
    f.drop()
    rejectPending(new RemoteClientError('TRANSPORT_CLOSED', 'disconnected'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(settled).not.toHaveBeenCalled()
    lifetime.abort()
    await released
    expect(f.events.size + f.closes.size).toBe(0)
    expect(vi.mocked(f.client.rpc).mock.calls.filter(([method]) => method === 'harness.remote.stream.open'))
      .toHaveLength(phase === 'open' ? 1 : 0)
  })

  it('fails a slow consumer while the carrier is still connected', async () => {
    const f = carrier()
    const stream = await new RemoteTypertGateway(f.client, undefined, undefined, true)
      .open('workspace/follow', { args: {} }, new AbortController().signal)
    for (let index = 0; index < 257; index++) f.frame({ type: 'upsert', item: String(index) })
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'TRANSPORT_CLOSED', message: expect.stringContaining('too slow'),
    })
    expect(f.events.size + f.closes.size).toBe(0)
  })
})
