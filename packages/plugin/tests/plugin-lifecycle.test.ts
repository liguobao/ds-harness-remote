import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as remotePlugin from '../src/index.js'
import type { Config } from '../src/config.js'
import type { ControlRouteHandler } from '../src/control-route.js'

const directories: string[] = []
const disabledAgentDomains = { codex: { enabled: false }, acp: { enabled: false } }

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('Cordis plugin lifecycle', () => {
  it('switches Server authority live and cancels discovery belonging to the old Server', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-server-switch-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)
    let config: Config = { ...disabledAgentDomains, serverUrl: 'https://old.example.com' }
    let handler!: ControlRouteHandler
    let oldRequestSignal: AbortSignal | null | undefined
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      requests.push(url)
      if (url === 'https://old.example.com/api/v1/auth/oauth/providers') {
        oldRequestSignal = init?.signal
        return new Promise<Response>((_resolve, reject) => {
          oldRequestSignal!.addEventListener('abort', () => reject(oldRequestSignal!.reason), { once: true })
        })
      }
      if (url === 'https://new.example.com/api/v1/auth/oauth/providers') {
        return Response.json({ items: [{ id: 'github', displayName: 'GitHub',
          startUrl: '/api/v1/auth/oauth/github/start', qrStartUrl: '/api/v1/auth/oauth/qr/start?provider=github' }] })
      }
      return Response.json({ error: { code: 'AUTHORIZATION_REQUIRED', message: 'Sign in required' } }, { status: 401 })
    }))
    const ctx = new Context()
    ctx.provide('settings', { register: () => ({
      get: () => config, replace: async (value: Config) => { config = value },
    }) } as never)
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', { rpc: { handle: (_channel: string, value: ControlRouteHandler) => {
      handler = value
      return async () => undefined
    } } } as never)
    const fiber = await ctx.plugin(remotePlugin, config)
    const call = (endpoint: string, payload: unknown = {}) => handler(endpoint, payload, new AbortController().signal)
    try {
      await vi.waitFor(() => { expect(ctx.dshRemoteClient.status().serverUrl).toBe(config.serverUrl) })
      const oldHost = ctx.dshRemote, oldClient = ctx.dshRemoteClient
      const hostClose = vi.spyOn(oldHost, 'close'), clientClose = vi.spyOn(oldClient, 'close')
      const pending = call('client.account.providers')
      await vi.waitFor(() => { expect(oldRequestSignal).toBeDefined() })
      await expect(call('settings.server.set', { serverUrl: 'https://new.example.com/' })).resolves.toMatchObject({
        ok: true, value: { config: { serverUrl: 'https://new.example.com' }, applies: 'live', associations: {} },
      })
      expect(oldRequestSignal?.aborted).toBe(true)
      await expect(pending).resolves.toMatchObject({ ok: false })
      expect(hostClose).toHaveBeenCalledOnce()
      expect(clientClose).toHaveBeenCalledOnce()
      expect(ctx.dshRemote).not.toBe(oldHost)
      expect(ctx.dshRemoteClient).not.toBe(oldClient)
      expect(ctx.dshRemote.currentIdentity().deviceId).not.toBe(oldHost.currentIdentity().deviceId)
      await expect(call('status')).resolves.toMatchObject({ ok: true, value: { serverUrl: 'https://new.example.com' } })
      await expect(call('client.account.providers')).resolves.toMatchObject({ ok: true, value: [{ id: 'github' }] })
      const newHost = ctx.dshRemote
      await call('settings.server.set', { serverUrl: 'https://new.example.com' })
      expect(ctx.dshRemote).toBe(newHost)
      expect(requests.filter(url => url === 'https://new.example.com/api/v1/auth/oauth/providers')).toHaveLength(1)
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('does not block Harness startup while runtime services are unavailable', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(remotePlugin, { ...disabledAgentDomains, deviceName: 'Cordis pending host' })

    expect(fiber.state).toBe(2)
    expect(fiber.inject).toEqual({})
    expect(ctx.get('dshRemote')).toBeUndefined()

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('loads against Typert and disposes its runtime', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-cordis-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    const ctx = new Context()
    let identityReadyWhenControlRegistered: boolean | undefined
    ctx.provide('settings', settings({ deviceName: 'Cordis test host' }))
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', connection(() => {
      try {
        ctx.dshRemote.currentIdentity()
        identityReadyWhenControlRegistered = true
      } catch {
        identityReadyWhenControlRegistered = false
      }
    }))
    const fiber = await ctx.plugin(remotePlugin, { ...disabledAgentDomains, deviceName: 'Cordis test host' })

    await vi.waitFor(() => {
      expect(ctx.dshRemote.currentIdentity()).toMatchObject({ name: 'Cordis test host' })
      expect(ctx.dshRemote.diagnostics()).toMatchObject({
        loaded: true,
        capabilities: expect.arrayContaining(['harness.remote.v1', 'harness.remote.transfer.v1']),
      })
    })
    expect(identityReadyWhenControlRegistered).toBe(false)

    await fiber.dispose()
    expect(ctx.get('dshRemote')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('waits for Desktop connection before activating even when Typert is ready', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-late-connection-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    const ctx = new Context()
    const handle = vi.fn(() => async () => undefined)
    ctx.provide('settings', settings({ deviceName: 'Cordis delayed connection host' }))
    ctx.provide('typertGateway', typertGateway())
    const fiber = await ctx.plugin(remotePlugin, { ...disabledAgentDomains, deviceName: 'Cordis delayed connection host' })

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
    let requestSignal: AbortSignal | null | undefined
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      requestSignal = init?.signal
      return new Promise<Response>((_resolve, reject) => {
        requestSignal!.addEventListener('abort', () => reject(requestSignal!.reason), { once: true })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

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
    const fiber = await ctx.plugin(remotePlugin, { ...disabledAgentDomains, deviceName: 'Cordis alpha host' })

    try {
      await vi.waitFor(() => {
        expect(ctx.dshRemote.currentIdentity()).toMatchObject({ name: 'Cordis alpha host' })
        expect(ctx.dshRemote.diagnostics()).toMatchObject({ loaded: true, serverConfigured: true })
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })
      expect(ctx.get('dshRemoteClient')).toBeUndefined()

      await fiber.dispose()
      expect(requestSignal?.aborted).toBe(true)
      expect(ctx.get('dshRemote')).toBeUndefined()
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('does not block a scoped TUI Host when optional scene registries are absent', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-tui-optional-seams-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    const register = vi.fn(() => () => undefined)
    const ctx = new Context()
    ctx.provide('loader', {
      locate: () => 'include:ds-harness-remote-tui',
      entries: () => [{ id: 'include:ds-harness-remote-tui', options: { id: 'ds-harness-remote-tui', name: 'ds-harness-remote' } }],
    } as never)
    ctx.provide('commands', { register })
    ctx.provide('settings', settings({ deviceName: 'Cordis optional-seams host' }))
    ctx.provide('typertGateway', typertGateway())

    const fiber = await ctx.plugin(remotePlugin, { ...disabledAgentDomains, deviceName: 'Cordis optional-seams host' })
    try {
      await vi.waitFor(() => expect(ctx.dshRemote.currentIdentity()).toBeDefined())
      expect(register).toHaveBeenCalledWith(expect.objectContaining({ name: 'remote' }))
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('keeps a carrier-less Desktop unavailable even when legacy ApiProxy is provided', async () => {
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
    ctx.provide('typertGateway', { invoke: vi.fn() } as never)
    ctx.provide('connection', {
      rpc: {
        handle: vi.fn((channel: string, handler: typeof handlers[number]['handler']) => {
          const entry = { channel, handler, disposed: false }
          handlers.push(entry)
          return async () => { entry.disposed = true }
        }),
      },
    } as never)
    const fiber = await ctx.plugin(remotePlugin, { ...disabledAgentDomains, deviceName: 'Cordis delayed rc.2 host' })

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
    ctx.provide('apiProxy', {} as never)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ctx.get('dshRemote')).toBeUndefined()
    expect(handlers[0]?.disposed).toBe(false)

    await fiber.dispose()
    expect(ctx.get('dshRemote')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})

function settings(value: Record<string, unknown>) {
  return {
    configure: () => () => undefined,
    // These tests exercise Harness registration/disposal, not installed Agent
    // CLIs. Keep optional processes out of the fixture (including the bundled
    // CodeX fallback, which is discoverable even with an isolated PATH).
    describe: () => [{ ns: 'ds-harness-remote', value: {
      ...disabledAgentDomains,
      ...value,
    } }],
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
  return { invoke: vi.fn(async () => undefined), dispatchRpc: vi.fn(async () => ({ ok: true })), openWireStream: vi.fn(async () => (async function* () {})()) } as never
}
