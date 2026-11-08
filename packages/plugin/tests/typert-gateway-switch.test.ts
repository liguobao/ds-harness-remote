import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { RemoteClientCore } from '@dsh-remote/client-core'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { RemoteTypertGateway } from '../src/remote-typert-gateway.js'
import type { TypertGatewayLike } from '../src/typert-gateway-contract.js'
import { TypertGatewaySwitch } from '../src/typert-gateway-switch.js'

describe('TypertGatewaySwitch', () => {
  it('preserves the calling peer on local RPC paths without forwarding it to a remote Host', async () => {
    const signal = new AbortController().signal
    const peer = { signal: new AbortController().signal }
    const payload = { args: {} }
    const localDispatch = vi.fn(async (_endpoint: string, _payload: unknown, callSignal: AbortSignal, callingPeer?: typeof peer) => {
      // New Gateway releases require this lifetime instead of supplying an operator fallback.
      const aborted = callingPeer!.signal.aborted
      expect(callingPeer).toBe(peer)
      expect(callSignal).toBe(signal)
      return { ok: true as const, value: aborted }
    })
    const gateway = { invoke: vi.fn(async () => 'local'), dispatchRpc: localDispatch }
    const originalDispatch = gateway.dispatchRpc
    const remote = {
      invoke: vi.fn(async () => 'remote'),
      dispatch: vi.fn(async (_endpoint: string, _payload: unknown, _signal: AbortSignal) => ({ ok: true as const, value: 'remote' })),
      open: vi.fn(async () => (async function* () {})()),
    }
    const target = new TypertGatewaySwitch(gateway)
    target.install()
    try {
      await runScenarios([
        { name: 'initial local mode', run: async () => {
          await expect(gateway.dispatchRpc('session/list', payload, signal, peer)).resolves.toEqual({ ok: true, value: false })
        } },
        { name: 'local-only namespace while remote is selected', run: async () => {
          target.selectRemote(remote)
          await expect(gateway.dispatchRpc('dynamicCordisRunner/inventory', payload, signal, peer)).resolves.toEqual({ ok: true, value: false })
          expect(remote.dispatch).not.toHaveBeenCalled()
        } },
        { name: 'remote calls keep their three-argument transport contract', run: async () => {
          target.selectRemote(remote)
          await expect(gateway.dispatchRpc('session/list', payload, signal, peer)).resolves.toEqual({ ok: true, value: 'remote' })
          expect(remote.dispatch).toHaveBeenCalledTimes(1)
          expect(remote.dispatch).toHaveBeenCalledWith('session/list', payload, signal)
        } },
        { name: 'explicit return to local mode', run: async () => {
          target.selectLocal()
          await expect(gateway.dispatchRpc('session/list', payload, signal, peer)).resolves.toEqual({ ok: true, value: false })
        } },
        { name: 'restore reinstates the original dispatcher', run: async () => {
          target.restore()
          expect(gateway.dispatchRpc).toBe(originalDispatch)
          await expect(gateway.dispatchRpc('session/list', payload, signal, peer)).resolves.toEqual({ ok: true, value: false })
        } },
      ])
    } finally {
      target.restore()
    }
  })
  it('supplies RC.1 terminal input flow control for older Hosts and projected backends', async () => {
    const gateway = { invoke: vi.fn(async (_request: Parameters<TypertGatewayLike['invoke']>[0]) => undefined as unknown), dispatchRpc: vi.fn(async (_endpoint: string, _payload: unknown, _signal: AbortSignal) => ({ ok: true as const, value: undefined as unknown })) }
    const switching = new TypertGatewaySwitch(gateway)
    switching.install()
    try {
      await runScenarios([undefined, 131072].map(maxBufferedBytes => ({ name: String(maxBufferedBytes), run: async () => {
        const value = { maxInputBytes: 65536, ...(maxBufferedBytes === undefined ? {} : { maxBufferedBytes }) }
        switching.selectRemote({ invoke: async () => value, dispatch: async () => ({ ok: true, value }), open: async () => (async function* () {})() })
        const expected = { ...value, maxBufferedBytes: maxBufferedBytes ?? 262144 }
        await expect(gateway.invoke({ namespace: 'terminal', method: 'environment', args: {} })).resolves.toEqual(expected)
        await expect(gateway.dispatchRpc('terminal/environment', {}, new AbortController().signal)).resolves.toEqual({ ok: true, value: expected })
      } })))
    } finally { switching.restore() }
  })

  it('returns remote RPC refusals in the official HTTP envelope without calling local services', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(owner => { new HostConnectionService(owner, [], {} as never) }).await()
      const connection = ctx.get('connection') as HostConnectionService
      const localDispatch = vi.fn(async (_endpoint: string, _payload: unknown, _signal: AbortSignal) => ({ ok: true as const, value: 'local' }))
      const gateway = { invoke: vi.fn(async () => 'local'), dispatchRpc: localDispatch }
      const target = new TypertGatewaySwitch(gateway)
      target.install()
      connection.rpc.intercept('/api', () => true, (endpoint, payload, signal) => gateway.dispatchRpc(endpoint, payload, signal))
      const peer = connection.createPeer({ principal: { kind: 'owner' } })
      const handler = connection.createSharedFetchHandler('/api')
      await runScenarios(['METHOD_NOT_ALLOWED', 'TRANSPORT_CLOSED'].map(code => ({
        name: code,
        run: async () => {
          target.selectRemote(new RemoteTypertGateway({ rpc: vi.fn(async () => {
            throw Object.assign(new Error('Remote request rejected'), { code })
          }) } as unknown as RemoteClientCore))
          const response = await handler.fetch(new Request('http://localhost/api/schedule/list', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'client-request', rpcId: 'schedule-read', method: 'schedule/list', payload: { args: { request: { sessionId: 's1' } } } }),
          }), peer)
          expect(response.status).toBe(200)
          expect(await response.json()).toMatchObject({
            type: 'server-response', rpcId: 'schedule-read', result: { ok: false, error: { code } },
          })
        },
      })))
      expect(localDispatch).not.toHaveBeenCalled()
      target.restore()
    } finally {
      await ctx.fiber.dispose()
    }
  })
  it('preserves preview bytes through the native Connection HTTP hop', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(owner => { new HostConnectionService(owner, [], {} as never) }).await()
      const connection = ctx.get('connection') as HostConnectionService
      const gateway = {
        invoke: vi.fn(async (_request: Parameters<TypertGatewayLike['invoke']>[0]) => 'local'),
        dispatchRpc: vi.fn(async (_endpoint: string, _payload: unknown, _signal: AbortSignal) => ({ ok: true as const, value: 'local' })),
      }
      const target = new TypertGatewaySwitch(gateway)
      target.install()
      connection.rpc.intercept('/api', () => true, (endpoint, payload, signal) => gateway.dispatchRpc(endpoint, payload, signal))
      const peer = connection.createPeer({ principal: { kind: 'owner' } })
      const handler = connection.createSharedFetchHandler('/api')
      await runScenarios(['workspaceFiles/readBytes', 'officeToPdf/render'].flatMap(endpoint =>
        [new Uint8Array([0, 255, 16]), new Uint8Array()].map(data => ({
          name: `${endpoint}: ${data.length === 0 ? 'empty' : 'binary'} payload`,
          run: async () => {
            const value = { data: Buffer.from(data).toString('base64'), version: 'v1', offset: 0, eof: true }
            const remote = new RemoteTypertGateway({ rpc: vi.fn(async () => ({ ok: true, value })) } as unknown as RemoteClientCore)
            target.selectRemote(remote)
            // In-process consumers still get bytes without Connection placeholders.
            await expect(gateway.invoke({ namespace: endpoint.split('/')[0]!, method: endpoint.split('/')[1]!, args: {} }))
              .resolves.toEqual({ ...value, data })
            const response = await handler.fetch(new Request(`http://localhost/api/${endpoint}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ type: 'client-request', rpcId: 'preview', method: endpoint, payload: { args: {} } }),
            }), peer)
            expect(response.status).toBe(200)
            expect(response.headers.get('content-type')).toContain('multipart/form-data')
            const parts = await response.formData()
            const metadata = JSON.parse(parts.get('metadata') as string)
            expect(metadata.result).toEqual({ ok: true, value: { ...value, data: null } })
            expect(metadata.attachments).toEqual([{ path: ['data'], codec: 'bytes', part: 'bytes-0' }])
            const blob = parts.get('bytes-0') as Blob
            expect(new Uint8Array(await blob.arrayBuffer())).toEqual(data)
          },
        })),
      ))
      target.selectLocal()
      await expect(gateway.dispatchRpc('workspaceFiles/readBytes', {}, new AbortController().signal))
        .resolves.toEqual({ ok: true, value: 'local' })
      target.restore()
    } finally {
      await ctx.fiber.dispose()
    }
  })
  it('fails remote session calls after disconnect until reconnect or explicit exit', async () => {
    const localInvoke = vi.fn(async (_request: Parameters<TypertGatewayLike['invoke']>[0]) => 'local')
    const localDispatch = vi.fn(async (_endpoint: string, _payload: unknown, _signal: AbortSignal) => ({ ok: true as const, value: 'local' }))
    const localOpen = vi.fn(async (_endpoint: string, _payload: unknown, _signal: AbortSignal) => (async function* () {})())
    const gateway = { invoke: localInvoke, dispatchRpc: localDispatch, openWireStream: localOpen }
    const target = new TypertGatewaySwitch(gateway)
    target.install()
    const remote = {
      invoke: vi.fn(async () => 'remote'),
      dispatch: vi.fn(async () => ({ ok: true as const, value: 'remote' })),
      open: vi.fn(async () => (async function* () {})()),
    }
    target.selectRemote(remote, undefined, { deviceId: 'agy', name: 'AGY' })
    target.disconnectRemote()
    expect(target.status()).toMatchObject({ mode: 'remote', target: { deviceId: 'agy' } })
    await expect(gateway.invoke({ namespace: 'session', method: 'create', args: {} })).rejects.toMatchObject({ code: 'remote/disconnected' })
    await expect(gateway.dispatchRpc('session/create', {}, new AbortController().signal)).resolves.toMatchObject({ ok: false, error: { code: 'remote/disconnected' } })
    await expect(gateway.openWireStream('session/follow', {}, new AbortController().signal)).rejects.toMatchObject({ code: 'remote/disconnected' })
    expect(localInvoke).not.toHaveBeenCalled()
    expect(localDispatch).not.toHaveBeenCalled()
    expect(localOpen).not.toHaveBeenCalled()
    target.selectRemote(remote)
    await expect(gateway.invoke({ namespace: 'session', method: 'create', args: {} })).resolves.toBe('remote')
    target.selectLocal()
    await expect(gateway.invoke({ namespace: 'session', method: 'create', args: {} })).resolves.toBe('local')
  })
  it('routes command catalog and execution to the selected Host while leaving other calls local', async () => {
    const localInvoke = vi.fn(async () => 'local')
    const remoteInvoke = vi.fn(async () => 'remote')
    const gateway: TypertGatewayLike = { invoke: localInvoke }
    const target = new TypertGatewaySwitch(gateway)
    const alwaysLocal = target.local()

    target.install()
    await expect(gateway.invoke(command())).resolves.toBe('local')
    await expect(gateway.invoke(commandList())).resolves.toBe('local')
    target.selectRemote(remoteInvoke)
    await expect(gateway.invoke(command())).resolves.toBe('remote')
    await expect(gateway.invoke(commandList())).resolves.toBe('remote')
    await expect(gateway.invoke({ namespace: 'goals', method: 'create', args: { agentId: 's1' } })).resolves.toBe('local')
    await expect(alwaysLocal.invoke(command())).resolves.toBe('local')
    target.selectLocal()
    await expect(gateway.invoke(command())).resolves.toBe('local')
    expect(remoteInvoke).toHaveBeenCalledTimes(2)
  })

  it('returns an empty command catalog for legacy Hosts while forwarding execution', async () => {
    const localInvoke = vi.fn(async () => 'local')
    const remoteInvoke = vi.fn(async () => 'remote')
    const gateway: TypertGatewayLike = { invoke: localInvoke }
    const target = new TypertGatewaySwitch(gateway)

    target.install()
    target.selectRemote(remoteInvoke, { execute: true, list: false })

    await expect(gateway.invoke(command())).resolves.toBe('remote')
    await expect(gateway.invoke(commandList())).resolves.toEqual([])
    expect(remoteInvoke).toHaveBeenCalledOnce()
    expect(localInvoke).not.toHaveBeenCalled()
  })

  it('restores the original gateway method', () => {
    const invoke = vi.fn(async () => undefined)
    const gateway: TypertGatewayLike = { invoke }
    const target = new TypertGatewaySwitch(gateway)
    target.install()
    target.restore()
    expect(gateway.invoke).toBe(invoke)
  })

  it('switches alpha unary, stream, and internal carrier calls together', async () => {
    const localInvoke = vi.fn(async (_request: Parameters<TypertGatewayLike['invoke']>[0]) => 'local-invoke')
    const localStream = vi.fn(async (_request: Parameters<TypertGatewayLike['invoke']>[0]) => (
      async function* () { yield 'local-stream' }
    )())
    const localDispatch = vi.fn(async (_endpoint: string, _payload: unknown, _signal: AbortSignal) => (
      { ok: true as const, value: 'local-dispatch' }
    ))
    const localOpen = vi.fn(async (_endpoint: string, _payload: unknown, _signal: AbortSignal) => (
      async function* () { yield 'local-open' }
    )())
    const gateway = {
      invoke: localInvoke,
      stream: localStream,
      dispatchRpc: localDispatch,
      openWireStream: localOpen,
      wireStream: {
        open: localOpen,
        failure: () => ({ code: 'internal', message: 'failed', details: {} }),
      },
    }
    const remote = {
      invoke: vi.fn(async () => 'remote-invoke'),
      dispatch: vi.fn(async () => ({ ok: true as const, value: 'remote-dispatch' })),
      open: vi.fn(async () => (async function* () { yield 'remote-open' })()),
    }
    const target = new TypertGatewaySwitch(gateway)
    const alwaysLocal = target.local()

    target.install()
    target.selectRemote(remote)

    await expect(gateway.invoke({ namespace: 'session', method: 'list', args: {} })).resolves.toBe('remote-invoke')
    await expect(gateway.dispatchRpc('session/list', { args: {} }, new AbortController().signal))
      .resolves.toEqual({ ok: true, value: 'remote-dispatch' })
    await expect(values(await gateway.openWireStream('$events', { args: {} }, new AbortController().signal)))
      .resolves.toEqual(['remote-open'])
    await expect(alwaysLocal.dispatch('session/list', { args: {} }, new AbortController().signal))
      .resolves.toEqual({ ok: true, value: 'local-dispatch' })

    target.selectLocal()
    await expect(gateway.invoke({ namespace: 'session', method: 'list', args: {} })).resolves.toBe('local-invoke')
    await expect(values(await gateway.openWireStream('session/follow', { args: {} }, new AbortController().signal)))
      .resolves.toEqual(['local-open'])
  })

  it('keeps dynamic Cordis UI runtime calls local in alpha remote mode', async () => {
    const localInvoke = vi.fn(async (_request: Parameters<TypertGatewayLike['invoke']>[0]) => 'local-invoke')
    const localStream = vi.fn(async (_request: Parameters<TypertGatewayLike['invoke']>[0]) => (
      async function* () { yield 'local-stream' }
    )())
    const localDispatch = vi.fn(async (_endpoint: string, _payload: unknown, _signal: AbortSignal) => (
      { ok: true as const, value: 'local-dispatch' }
    ))
    const localOpen = vi.fn(async (_endpoint: string, _payload: unknown, _signal: AbortSignal) => (
      async function* () { yield 'local-open' }
    )())
    const gateway = {
      invoke: localInvoke,
      stream: localStream,
      dispatchRpc: localDispatch,
      openWireStream: localOpen,
      wireStream: {
        open: localOpen,
        failure: () => ({ code: 'internal', message: 'failed', details: {} }),
      },
    }
    const remote = {
      invoke: vi.fn(async () => 'remote-invoke'),
      dispatch: vi.fn(async () => ({ ok: true as const, value: 'remote-dispatch' })),
      open: vi.fn(async () => (async function* () { yield 'remote-open' })()),
    }
    const target = new TypertGatewaySwitch(gateway)
    const signal = new AbortController().signal

    target.install()
    target.selectRemote(remote)

    await expect(gateway.invoke({ namespace: 'dynamicCordisRunner', method: 'inventory', args: {} }))
      .resolves.toBe('local-invoke')
    await expect(values(await gateway.stream({ namespace: 'dynamicCordisRunner', method: 'events', args: {} })))
      .resolves.toEqual(['local-stream'])
    await expect(gateway.dispatchRpc('dynamicCordisRunner/getClientCode', { args: {} }, signal))
      .resolves.toEqual({ ok: true, value: 'local-dispatch' })
    await expect(values(await gateway.openWireStream('dynamicCordisRunner/events', { args: {} }, signal)))
      .resolves.toEqual(['local-open'])
    expect(remote.invoke).not.toHaveBeenCalled()
    expect(remote.dispatch).not.toHaveBeenCalled()
    expect(remote.open).not.toHaveBeenCalled()
  })
  it('supplies the fallback owner Peer for local rc.1 opens and rejects a peerless one', async () => {
    const calls: unknown[][] = []
    // A real six-parameter function keeps `.length === 6` so the switch detects the rc.1 arity.
    function rc1Open(
      endpoint: string,
      payload: unknown,
      uplink: AsyncIterable<unknown>,
      peer: unknown,
      signal: AbortSignal,
      control: AbortController,
    ): Promise<AsyncIterable<unknown>> {
      calls.push([endpoint, payload, uplink, peer, signal, control])
      return Promise.resolve((async function* () { yield 'rc1-open' })())
    }
    const gateway = {
      invoke: vi.fn(async () => 'local-invoke'),
      dispatchRpc: vi.fn(async () => ({ ok: true as const, value: 'local-dispatch' })),
      openWireStream: rc1Open,
      wireStream: {
        open: async (_endpoint: string, _payload: unknown, _signal: AbortSignal) => (async function* () { yield 'rc1-wire' })(),
        failure: () => ({ code: 'internal', message: 'failed', details: {} }),
      },
    }
    const remote = {
      invoke: vi.fn(async () => 'remote-invoke'),
      dispatch: vi.fn(async () => ({ ok: true as const, value: 'remote-dispatch' })),
      open: vi.fn(async () => (async function* () { yield 'remote-open' })()),
    }
    // Harness 0.2.2 dereferences peer.signal for forwarded events; a local
    // carrier without a per-connection peer must use the shared owner fallback.
    const fallbackPeer = { signal: new AbortController().signal, principal: { kind: 'owner' } }
    const target = new TypertGatewaySwitch(gateway, () => fallbackPeer)
    const alwaysLocal = target.local()
    target.install()
    target.selectRemote(remote)

    const signal = new AbortController().signal
    const explicitPeer = { signal: new AbortController().signal }
    await expect(values(await target.local(explicitPeer).open('$events', { args: {} }, signal))).resolves.toEqual(['rc1-open'])
    expect(calls).toHaveLength(1)
    expect(calls[0]![3]).toBe(explicitPeer)
    calls.length = 0
    await expect(values(await alwaysLocal.open('$events', { args: {} }, signal))).resolves.toEqual(['rc1-open'])
    expect(calls).toHaveLength(1)
    const args = calls[0]!
    expect(typeof (args[2] as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator]).toBe('function')
    expect(args[3]).toBe(fallbackPeer)
    expect(args[4]).toBe(signal)
    expect(args[5]).toBeInstanceOf(AbortController)

    // Without any owner Peer the open fails with an actionable error, not a
    // TypeError from the official Gateway dereferencing `peer.signal`.
    const peerlessGateway = {
      invoke: vi.fn(async () => 'local-invoke'),
      dispatchRpc: vi.fn(async () => ({ ok: true as const, value: 'local-dispatch' })),
      openWireStream: rc1Open,
      wireStream: gateway.wireStream,
    }
    const peerless = new TypertGatewaySwitch(peerlessGateway).local()
    await expect(peerless.open('$events', { args: {} }, signal)).rejects.toThrow(/requires an owner Peer/)

    // The public carrier wrapper receives the same rc.1 argument order from the mux.
    calls.length = 0
    const muxSignal = new AbortController().signal
    const uplink = (async function* () {})()
    await expect(values(await gateway.openWireStream('$events', { args: {} }, uplink, undefined, muxSignal, new AbortController())))
      .resolves.toEqual(['remote-open'])
    expect(remote.open).toHaveBeenCalledWith('$events', { args: {} }, muxSignal)
  })

  it('keeps the legacy three-argument carrier contract for older Hosts', async () => {
    const legacy = vi.fn(async (_endpoint: string, _payload: unknown, _signal: AbortSignal) => (
      async function* () { yield 'legacy-open' }
    )())
    const gateway = {
      invoke: vi.fn(async () => 'local-invoke'),
      dispatchRpc: vi.fn(async () => ({ ok: true as const, value: 'local-dispatch' })),
      openWireStream: legacy,
      wireStream: { open: legacy, failure: () => ({ code: 'internal', message: 'failed', details: {} }) },
    }
    const target = new TypertGatewaySwitch(gateway)
    const alwaysLocal = target.local()
    target.install()

    const signal = new AbortController().signal
    await expect(values(await alwaysLocal.open('session/follow', { args: {} }, signal))).resolves.toEqual(['legacy-open'])
    expect(legacy).toHaveBeenCalledWith('session/follow', { args: {} }, signal)
  })
})

async function values(source: AsyncIterable<unknown>): Promise<unknown[]> {
  const result: unknown[] = []
  for await (const value of source) result.push(value)
  return result
}

function command(): Parameters<TypertGatewayLike['invoke']>[0] {
  return { namespace: 'commands', method: 'execute', args: { agentId: 's1', line: '/permission danger-full-access', images: [] } }
}

function commandList(): Parameters<TypertGatewayLike['invoke']>[0] {
  return { namespace: 'commands', method: 'list', args: { agentId: 's1' } }
}
