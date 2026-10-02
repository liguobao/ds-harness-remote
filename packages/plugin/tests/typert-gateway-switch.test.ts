import { describe, expect, it, vi } from 'vitest'
import type { TypertGatewayLike } from '../src/harness-api-bridge.js'
import { TypertGatewaySwitch } from '../src/typert-gateway-switch.js'

describe('TypertGatewaySwitch', () => {
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
  it('carries the signal to the rc.1 fifth slot and never as the third argument (P0-2)', async () => {
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
    const target = new TypertGatewaySwitch(gateway)
    const alwaysLocal = target.local()
    target.install()
    target.selectRemote(remote)

    const signal = new AbortController().signal
    await expect(values(await alwaysLocal.open('$events', { args: {} }, signal))).resolves.toEqual(['rc1-open'])
    expect(calls).toHaveLength(1)
    const args = calls[0]!
    expect(typeof (args[2] as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator]).toBe('function')
    expect(args[3]).toBeUndefined()
    expect(args[4]).toBe(signal)
    expect(args[5]).toBeInstanceOf(AbortController)

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
