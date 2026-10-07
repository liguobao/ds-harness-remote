import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as remotePlugin from '../src/index.js'

const directories: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('Cordis plugin lifecycle', () => {
  it('does not block Harness startup while runtime services are unavailable', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(remotePlugin, { deviceName: 'Cordis pending host' })

    expect(fiber.state).toBe(2)
    expect(fiber.inject).toEqual({})
    expect(ctx.get('dshRemote')).toBeUndefined()

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('loads against ApiProxy and disposes its runtime', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-cordis-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    const ctx = new Context()
    let identityReadyWhenControlRegistered: boolean | undefined
    ctx.provide('settings', settings({ deviceName: 'Cordis test host' }))
    ctx.provide('apiProxy', apiProxy())
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', connection(() => {
      try {
        ctx.dshRemote.currentIdentity()
        identityReadyWhenControlRegistered = true
      } catch {
        identityReadyWhenControlRegistered = false
      }
    }))
    const fiber = await ctx.plugin(remotePlugin, { deviceName: 'Cordis test host' })

    await vi.waitFor(() => {
      expect(ctx.dshRemote.currentIdentity()).toMatchObject({ name: 'Cordis test host' })
      expect(ctx.dshRemote.diagnostics()).toMatchObject({
        loaded: true,
        capabilities: expect.arrayContaining(['harness.api.v1', 'harness.api.transfer.v1']),
      })
    })
    expect(identityReadyWhenControlRegistered).toBe(false)

    await fiber.dispose()
    expect(ctx.get('dshRemote')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('waits for Desktop connection before activating even when ApiProxy is ready', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-late-connection-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    const ctx = new Context()
    const handle = vi.fn(() => async () => undefined)
    ctx.provide('settings', settings({ deviceName: 'Cordis delayed connection host' }))
    ctx.provide('apiProxy', apiProxy())
    ctx.provide('typertGateway', typertGateway())
    const fiber = await ctx.plugin(remotePlugin, { deviceName: 'Cordis delayed connection host' })

    expect(ctx.get('dshRemote')).toBeUndefined()
    ctx.provide('connection', { rpc: { handle } } as never)
    await vi.waitFor(() => {
      expect(ctx.dshRemote.currentIdentity()).toMatchObject({ name: 'Cordis delayed connection host' })
    })
    expect(handle).toHaveBeenCalledWith('/ds-harness-remote', expect.any(Function), {
      authority: 'loopback',
    })

    await fiber.dispose()
    expect(ctx.get('dshRemote')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('loads a TUI Host against the v0.1.2 Typert Remote Gateway without a Desktop connection service', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-alpha-cordis-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    const ctx = new Context()
    ctx.provide('commands', { register: vi.fn(() => vi.fn()) })
    ctx.provide('tuiCommandTrees', { register: vi.fn(() => vi.fn()) })
    ctx.provide('tuiScenes', { register: vi.fn(() => vi.fn()), open: vi.fn(() => true) })
    ctx.provide('settings', settings({ deviceName: 'Cordis alpha host' }))
    ctx.provide('typertGateway', {
      invoke: vi.fn(async () => undefined),
      dispatchRpc: vi.fn(async () => ({ ok: true, value: undefined })),
      openWireStream: vi.fn(async () => (async function* () { return })()),
      wireStream: {
        open: vi.fn(async () => (async function* () { return })()),
        failure: vi.fn(() => ({ code: 'internal', message: 'failed', details: {} })),
      },
    } as never)
    const fiber = await ctx.plugin(remotePlugin, { deviceName: 'Cordis alpha host' })

    await vi.waitFor(() => {
      expect(ctx.dshRemote.currentIdentity()).toMatchObject({ name: 'Cordis alpha host' })
      expect(ctx.dshRemote.diagnostics()).toMatchObject({ loaded: true, serverConfigured: true })
    })
    expect(ctx.get('dshRemoteClient')).toBeUndefined()

    await fiber.dispose()
    expect(ctx.get('dshRemote')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('waits for a late legacy ApiProxy instead of activating rc.2 without it', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-late-apiproxy-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    const ctx = new Context()
    const handlers: Array<{
      channel: string
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>
      disposed: boolean
    }> = []
    ctx.provide('settings', settings({ deviceName: 'Cordis delayed rc.2 host' }))
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', {
      rpc: {
        handle: vi.fn((channel: string, handler: typeof handlers[number]['handler']) => {
          const entry = { channel, handler, disposed: false }
          handlers.push(entry)
          return async () => { entry.disposed = true }
        }),
      },
    } as never)
    const fiber = await ctx.plugin(remotePlugin, { deviceName: 'Cordis delayed rc.2 host' })

    expect(ctx.get('dshRemote')).toBeUndefined()
    expect(handlers).toHaveLength(1)
    expect(handlers[0]?.channel).toBe('/ds-harness-remote')
    await expect(handlers[0]?.handler('status', {}, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: {
        mode: 'local',
        available: false,
        hostAuthorizationAvailable: false,
      },
    })
    ctx.provide('apiProxy', apiProxy())
    await vi.waitFor(() => {
      expect(ctx.dshRemote.currentIdentity()).toMatchObject({ name: 'Cordis delayed rc.2 host' })
    })
    expect(handlers[0]?.disposed).toBe(true)
    expect(handlers.at(-1)?.disposed).toBe(false)

    await fiber.dispose()
    expect(ctx.get('dshRemote')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})

function settings(value: Record<string, unknown>) {
  return {
    configure: () => () => undefined,
    describe: () => [{ ns: 'ds-harness-remote', value }],
    replace: vi.fn(async () => undefined),
  } as never
}

type ControlHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>

function connection(onHandle?: () => void) {
  return {
    rpc: {
      handle: vi.fn(() => {
        onHandle?.()
        return async () => undefined
      }),
    },
  } as never
}

function typertGateway() {
  return { invoke: vi.fn(async () => undefined) } as never
}

function apiProxy(describeHost?: ApiProxy['host']['describe']): ApiProxy {
  const empty = {}
  return {
    sessions: empty,
    subagents: empty,
    host: describeHost === undefined ? empty : { describe: describeHost },
    workspace: empty,
    skills: empty,
    agentPresets: empty,
    goals: empty,
    settings: empty,
    credentials: empty,
    llm: empty,
    events: { mux: async function* () { return }, host: async function* () { return } },
    downloads: empty,
    respond: async () => ({ accepted: true }),
  } as unknown as ApiProxy
}
