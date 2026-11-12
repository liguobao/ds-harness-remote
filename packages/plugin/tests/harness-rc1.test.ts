import { Context } from '@deepseek-ai/cordis'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import Registry from '@deepseek-ai/dsh-typert-registry'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { HarnessRemoteBridge } from '../src/harness-remote-bridge.js'
import { TypertGatewaySwitch } from '../src/typert-gateway-switch.js'
import type { TypertGatewayLike } from '../src/typert-gateway-contract.js'

// Exercise the installed RC.1 implementation, including its Peer identity check.
describe('Harness RC.1 authenticated carrier', () => {
  it('reports an incomplete Host with the official Gateway and no Remote API packages', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(Registry).await()
      await ctx.plugin(RemoteAccess).await()
      await ctx.plugin(Gateway).await()
      const gateway = ctx.get('typertGateway') as Gateway
      const peer = new Peer(ctx, { principal: { kind: 'owner' }, interactions: 'answer' })
      const local = new TypertGatewaySwitch(gateway as unknown as TypertGatewayLike).local(peer)
      expect(await local.dispatch('session/list', { args: { _request: {} } }, new AbortController().signal))
        .toMatchObject({ ok: false, error: { code: 'gateway/invocation-unavailable' } })
      const publish = vi.fn(async () => undefined)
      const warn = vi.fn()
      const bridge = new HarnessRemoteBridge(local, publish, { warn } as never)
      await bridge.openStream({ streamId: 'missing-events', endpoint: '$events', payload: { args: {} } })
      await vi.waitFor(() => expect(publish).toHaveBeenCalledWith('harness.remote.stream.closed', {
        streamId: 'missing-events', reason: 'failed',
        failure: expect.objectContaining({ code: 'gateway/service-unavailable' }),
      }))
      expect(warn).toHaveBeenCalledOnce()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Install @deepseek-ai/dsh-api-remotes'))
      expect(publish).not.toHaveBeenCalledWith('harness.remote.frame', expect.anything())
      await bridge.closeAll()
      await peer.dispose()
    } finally { await ctx.fiber.dispose() }
  })

  it('calls an active Session API through the official Gateway', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(Registry).await()
      await ctx.plugin(RemoteAccess).await()
      await ctx.plugin(Gateway).await()
      const list = vi.fn(async (_request: object) => [])
      const session = { list } as { list: typeof list; typertRemote?: unknown }
      session.typertRemote = { service: session, serviceKey: 'session', namespace: 'session' }
      ctx.provide('session', session as never)
      ctx.typert.register({
        package: 'session-fixture', face: 'host', schemas: [],
        model: { services: [], events: [], objects: [] },
        invocations: [{
          id: 'session-fixture:list', service: 'session', namespace: 'session', method: 'list',
          invocation: { kind: 'direct' },
          parameters: [{ name: '_request', wire: '_request', source: 'json', codec: {
            mode: 'strict', typeSymbol: 'SessionListRequest', create: () => z.object({ cursor: z.string().optional() }),
          } }],
          result: { mode: 'src-json' },
        }],
      })
      const gateway = ctx.get('typertGateway') as Gateway
      const peer = new Peer(ctx, { principal: { kind: 'owner' }, interactions: 'answer' })
      const local = new TypertGatewaySwitch(gateway as unknown as TypertGatewayLike).local(peer)
      const signal = new AbortController().signal
      expect(await local.dispatch('session/list', { args: {} }, signal))
        .toMatchObject({ ok: false, error: { code: 'gateway/arguments-invalid' } })
      expect(await local.dispatch('session/list', { args: { _request: {} } }, signal))
        .toEqual({ ok: true, value: [] })
      expect(list).toHaveBeenCalledWith({})
      await peer.dispose()
    } finally { await ctx.fiber.dispose() }
  })

  it('isolates event replies and ends all carrier access with its admitted Peer', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(Registry).await()
      await ctx.plugin(RemoteAccess).await()
      await ctx.plugin(Gateway).await()
      const gateway = ctx.get('typertGateway') as Gateway
      gateway.registerRemoteEvents(async function* (signal) {
        if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
      }, { home: '/fixture' })
      const peerA = new Peer(ctx, { principal: { kind: 'owner' } })
      const peerB = new Peer(ctx, { principal: { kind: 'owner' } })
      const switching = new TypertGatewaySwitch(gateway as unknown as TypertGatewayLike)
      const a = switching.local(peerA)
      // Creating B after the switch installs must still capture the original Host.
      switching.install()
      switching.selectRemote({ invoke: async () => { throw new Error('recursion') }, dispatch: async () => { throw new Error('recursion') }, open: async () => { throw new Error('recursion') } })
      const b = switching.local(peerB)
      const control = new AbortController()
      const streamA = (await a.open('$events', { args: {} }, control.signal))[Symbol.asyncIterator]()
      const streamB = (await b.open('$events', { args: {} }, control.signal))[Symbol.asyncIterator]()
      const readyA = (await streamA.next()).value as { clientId: string }
      await streamB.next()
      const payload = { args: { clientId: readyA.clientId, eventId: '00000000-0000-4000-8000-000000000001', outcome: { kind: 'next' } } }
      expect(await b.dispatch('$events/result', payload, control.signal)).toMatchObject({ ok: false, error: { code: 'gateway/interactions-forbidden' } })
      const access = (await a.open('remoteAccess/follow', { args: {} }, control.signal))[Symbol.asyncIterator]()
      expect((await access.next()).value).toMatchObject({ type: 'baseline', owner: true })
      a.dispose = () => peerA.dispose()
      await new HarnessRemoteBridge(a, async () => undefined).closeAll()
      expect(await a.dispatch('session/list', { args: {} }, control.signal)).toMatchObject({ ok: false, error: { code: 'gateway/peer-disposed' } })
      await expect(a.invoke({ namespace: 'session', method: 'list', args: {}, peer: peerB })).rejects.toMatchObject({ code: 'gateway/peer-disposed' })
      await expect(a.open('$events', { args: {} }, control.signal)).rejects.toMatchObject({ code: 'gateway/peer-disposed' })
      expect(peerB.signal.aborted).toBe(false)
      control.abort()
      await Promise.all([streamA.return?.(), streamB.return?.(), access.return?.()])
      switching.restore()
    } finally { await ctx.fiber.dispose() }
  })
})
