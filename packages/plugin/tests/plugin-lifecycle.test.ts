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
  it('migrates only owned legacy entries without disabling an unrelated plugin', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-legacy-ownership-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline fixture') }))
    const entries = [
      { id: 'current', options: { id: 'current', name: '@dsh-remote/plugin', disabled: false } },
      { id: 'foreign', options: { id: 'foreign', name: 'dsh-remote', disabled: false } },
      { id: 'foreign-null', options: { id: 'foreign-null', name: 'dsh-remote', disabled: null } },
      { id: 'foreign-disabled', options: { id: 'foreign-disabled', name: 'dsh-remote', disabled: true } },
      { id: 'owned', options: { id: 'owned', name: '@dsh-remote/plugin', disabled: false } },
      { id: 'owned-disabled', options: { id: 'owned-disabled', name: '@dsh-remote/plugin', disabled: true } },
      { id: 'other', options: { id: 'other', name: 'another-plugin', disabled: false } },
    ]
    const update = vi.fn(async (id: string, options: { disabled?: boolean | null }) => {
      Object.assign(entries.find(entry => entry.id === id)!.options, options)
    })
    const ctx = new Context()
    ctx.provide('loader', { locate: () => 'current', entries: () => entries, update } as never)
    ctx.provide('settings', settings({ deviceName: 'Cordis ownership test host' }))
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', connection())
    const fiber = await ctx.plugin(remotePlugin, { ...disabledAgentDomains, deviceName: 'Cordis ownership test host' })
    try {
      await vi.waitFor(() => expect(ctx.dshRemote.currentIdentity()).toBeDefined())
      expect(update.mock.calls).toEqual([['owned', { disabled: true }]])
      expect(entries.map(entry => [entry.id, entry.options.disabled])).toEqual([
        ['current', false], ['foreign', false], ['foreign-null', null], ['foreign-disabled', true],
        ['owned', true], ['owned-disabled', true], ['other', false],
      ])
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('keeps the entry Config on a registry that resolves a registration without a stored section', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-legacy-registry-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline fixture') }))
    const config: Config = {
      ...disabledAgentDomains,
      serverUrl: 'https://legacy.example.com',
      loopback: { ports: [8080] },
      acp: { enabled: true },
    }
    // `dsh-settings@0.2.1-rc.3` resolves a registration as
    // `schema(mergeLayers(base, user))`; a plugin with no stored section has no
    // override layer, and `mergeLayers` then returns that layer unchanged, so
    // `base` never reaches the schema. The registry also calls the schema
    // directly, so a volatile entry schema resolves to a `{ get }` accessor.
    let registerSchema: ((input?: unknown) => unknown) | undefined
    let resolvedFromSchema: unknown
    const register = vi.fn((_ns: string, schema: (input?: unknown) => unknown, options?: { validate?: (value: unknown) => void }) => {
      registerSchema = schema
      resolvedFromSchema = schema(undefined)
      options?.validate?.(resolvedFromSchema)
      return { get: () => resolvedFromSchema, replace: async () => undefined }
    })
    const ctx = new Context()
    ctx.provide('settings', { register } as never)
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', connection())
    const fiber = await ctx.plugin(remotePlugin, config)
    try {
      await vi.waitFor(() => { expect(ctx.get('dshRemote')).toBeDefined() })
      expect(register).toHaveBeenCalledOnce()
      expect(ctx.dshRemoteClient.status().serverUrl).toBe('https://legacy.example.com')
      // Nested entry Config must survive: schemastery resolves `loopback` and
      // `acp` to default-only containers, which previously overwrote the entry
      // Config when it was merged as a flat layer on read.
      expect(resolvedFromSchema).toMatchObject({ loopback: { ports: [8080] }, acp: { enabled: true } })
      // A stored section still wins, including an explicit reset to an empty list.
      expect(registerSchema?.({ loopback: { ports: [] } })).toMatchObject({ loopback: { ports: [] } })
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
  })

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

  it('automatically migrates storage on upgrade before loading Typert and disposes its runtime', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-cordis-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    const original = await new remotePlugin.IdentityStore({ directory: join(dshHome, 'remote') }).loadOrCreate('Cordis test host')

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
    expect(ctx.dshRemote.currentIdentity()).toEqual(original)

    expect(identityReadyWhenControlRegistered).toBe(false)

    await fiber.dispose()
    expect(ctx.get('dshRemote')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('migrates legacy storage with interrupted credential temp files and dead lock, then refreshes expired Host accessToken on startup', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-367-upgrade-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    const serverUrl = 'https://dsh.r2049.cn'
    const legacyRoot = join(dshHome, 'remote')
    const hostDir = remotePlugin.serverStorageDirectory(legacyRoot, serverUrl, 'host')
    const clientDir = remotePlugin.serverStorageDirectory(legacyRoot, serverUrl, 'client')
    const hostStore = new remotePlugin.IdentityStore({ directory: hostDir, role: 'host' })
    const hostIdentity = await hostStore.loadOrCreate('Host')
    const clientIdentity = await new remotePlugin.IdentityStore({ directory: clientDir, role: 'client' }).loadOrCreate('Client')
    const trustedPeer = await hostStore.trustPeer({
      deviceId: clientIdentity.deviceId,
      name: 'Client',
      platform: 'linux',
      publicKey: clientIdentity.publicKey,
    })
    const now = Date.now()
    await new remotePlugin.ServerCredentialStore(hostDir).save({
      serverUrl,
      deviceId: hostIdentity.deviceId,
      authorizationMethod: 'account',
      account: 'host@example.com',
      accessToken: 'expired-access-token-0000',
      accessTokenExpiresAt: now - 345_000,
      refreshToken: 'valid-refresh-token-0000',
      refreshTokenExpiresAt: now + 86_400_000,
    })
    const { readFile, writeFile } = await import('node:fs/promises')
    const { createHash } = await import('node:crypto')
    const { spawn } = await import('node:child_process')
    const firstChild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 50)'], { stdio: 'ignore' })
    const secondChild = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    await Promise.all([
      new Promise<void>(resolve => firstChild.once('exit', () => resolve())),
      new Promise<void>(resolve => secondChild.once('exit', () => resolve())),
    ])
    const exitedOwnerPid = firstChild.pid!
    const exitedTakeoverPid = secondChild.pid!
    const lockRecord = `${exitedOwnerPid}\n`
    const takeoverName = `device.lock.takeover-${createHash('sha256').update(lockRecord).digest('hex').slice(0, 16)}`
    const hostDeviceBytes = await readFile(join(hostDir, 'device.json'))
    const hostKeyBytes = await readFile(join(hostDir, 'device.key'))
    const hostPeersBytes = await readFile(join(hostDir, 'trusted-peers.json'))
    await writeFile(join(hostDir, `server-credentials.json.${exitedOwnerPid}.01a1b6d8-e8b5-7000-8000-000000000002.tmp`), '{partial', { mode: 0o600 })
    await writeFile(join(hostDir, 'device.lock'), lockRecord, { mode: 0o600 })
    await writeFile(join(hostDir, takeoverName), `${exitedTakeoverPid}\n`, { mode: 0o600 })

    const refreshedAccessToken = 'refreshed-access-token-1111'
    const refreshedExpiresAt = now + 597_000
    const refreshCalls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      refreshCalls.push(url)
      if (url.endsWith('/api/v1/auth/refresh')) {
        return Response.json({
          accessToken: refreshedAccessToken,
          accessTokenExpiresAt: refreshedExpiresAt,
          refreshToken: 'valid-refresh-token-1111',
          refreshTokenExpiresAt: now + 86_400_000,
        })
      }
      return Response.json({ items: [] })
    }))

    const ctx = new Context()
    ctx.provide('settings', settings({ deviceName: 'Host', serverUrl }))
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', connection())
    const fiber = await ctx.plugin(remotePlugin, { ...disabledAgentDomains, deviceName: 'Host', serverUrl })
    try {
      const migratedHostDir = remotePlugin.serverStorageDirectory(join(dshHome, 'ds-harness-remote'), serverUrl, 'host')
      await vi.waitFor(async () => {
        expect(refreshCalls.some(url => url.endsWith('/api/v1/auth/refresh'))).toBe(true)
        const updated = await new remotePlugin.ServerCredentialStore(migratedHostDir).load(serverUrl, hostIdentity.deviceId)
        expect(updated?.accessToken).toBe(refreshedAccessToken)
        expect(updated?.accessTokenExpiresAt).toBe(refreshedExpiresAt)
      }, { timeout: 5_000 })
      expect(ctx.dshRemote.currentIdentity()).toEqual(hostIdentity)
      expect(await readFile(join(migratedHostDir, 'device.json'))).toEqual(hostDeviceBytes)
      expect(await readFile(join(migratedHostDir, 'device.key'))).toEqual(hostKeyBytes)
      expect(await readFile(join(migratedHostDir, 'trusted-peers.json'))).toEqual(hostPeersBytes)
      const reloadedStore = new remotePlugin.IdentityStore({ directory: migratedHostDir, role: 'host' })
      await reloadedStore.loadOrCreate('Host')
      expect(reloadedStore.listTrustedPeers()).toEqual([trustedPeer])
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
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
    await vi.waitFor(() => expect(handlers).toHaveLength(1))
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

  it('keeps loopback control alive when legacy storage has a credentialed corrupt client and recovers live on reset', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-corrupt-recovery-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(
      { error: { code: 'AUTHORIZATION_REQUIRED', message: 'Sign in required' } },
      { status: 401 },
    )))

    const serverUrl = 'https://dsh.r2049.cn'
    const legacyRoot = join(dshHome, 'remote')
    const hostDir = remotePlugin.serverStorageDirectory(legacyRoot, serverUrl, 'host')
    const clientDir = remotePlugin.serverStorageDirectory(legacyRoot, serverUrl, 'client')
    const hostIdentity = await new remotePlugin.IdentityStore({ directory: hostDir, role: 'host' }).loadOrCreate('Host')
    const clientIdentity = await new remotePlugin.IdentityStore({ directory: clientDir, role: 'client' }).loadOrCreate('Client')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(clientDir, 'device.key'), 'corrupted-key\n')
    await new remotePlugin.ServerCredentialStore(clientDir).save({
      serverUrl,
      deviceId: clientIdentity.deviceId,
      authorizationMethod: 'owned_device',
      accessToken: 'c'.repeat(24),
      accessTokenExpiresAt: Date.now() + 60_000,
      refreshToken: 'r'.repeat(24),
      refreshTokenExpiresAt: Date.now() + 600_000,
    })

    let config: Config = { ...disabledAgentDomains, serverUrl }
    let handler!: ControlRouteHandler
    const ctx = new Context()
    ctx.provide('settings', { register: () => ({
      get: () => config,
      replace: async (value: Config) => { config = value },
    }) } as never)
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', { rpc: { handle: (_channel: string, value: ControlRouteHandler) => {
      handler = value
      return async () => undefined
    } } } as never)

    const fiber = await ctx.plugin(remotePlugin, config)
    const call = (endpoint: string, payload: unknown = {}) => handler(endpoint, payload, new AbortController().signal)
    try {
      await vi.waitFor(() => expect(handler).toBeDefined())
      await expect(call('status')).resolves.toMatchObject({
        ok: true,
        value: {
          available: false,
          controlUnavailable: false,
          startupError: { code: 'IDENTITY_INVALID' },
        },
      })
      await expect(call('settings.identity.reset', { role: 'client' })).resolves.toMatchObject({
        ok: true,
        value: { applies: 'live' },
      })
      expect(ctx.dshRemote.currentIdentity().deviceId).toBe(hostIdentity.deviceId)
      const statusAfter = await call('status')
      expect(statusAfter).toMatchObject({
        ok: true,
        value: {
          available: true,
          identityReady: true,
        },
      })
      expect((statusAfter as { value?: { startupError?: unknown } }).value?.startupError).toBeUndefined()
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('registers loopback control, remote tools, and live Server switching when another plugin already provides dshRemote services', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-service-conflict-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(
      { error: { code: 'AUTHORIZATION_REQUIRED', message: 'Sign in required' } },
      { status: 401 },
    )))

    let config: Config = { ...disabledAgentDomains, serverUrl: 'https://old.example.com' }
    let handler: ControlRouteHandler | undefined
    const registeredTools: string[] = []
    const foreignHostService = { apiVersion: 1 }
    const foreignClientService = { foreignClient: true }

    const ctx = new Context()
    ctx.provide('settings', { register: () => ({
      get: () => config,
      replace: async (value: Config) => { config = value },
    }) } as never)
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', { rpc: { handle: (_channel: string, value: ControlRouteHandler) => {
      handler = value
      return async () => undefined
    } } } as never)
    ctx.provide('tools', {
      register: (tool: { name: string }) => {
        registeredTools.push(tool.name)
        return () => undefined
      },
    } as never)

    const foreignFiber = await ctx.plugin({
      name: 'dsh-remote',
      apply(peerCtx: Context) {
        peerCtx.provide('dshRemote', foreignHostService as never)
        peerCtx.provide('dshRemoteClient', foreignClientService as never)
      },
    })
    const fiber = await ctx.plugin(remotePlugin, config)
    const call = (endpoint: string, payload: unknown = {}) => handler!(endpoint, payload, new AbortController().signal)
    try {
      await vi.waitFor(() => {
        expect(handler).toBeDefined()
        expect(registeredTools).toContain('remote_list_hosts')
      })
      expect(ctx.get('dshRemote')).toBe(foreignHostService)
      expect(ctx.get('dshRemoteClient')).toBe(foreignClientService)
      await expect(call('status')).resolves.toMatchObject({
        ok: true,
        value: {
          available: true,
          serverUrl: 'https://old.example.com',
        },
      })
      await expect(call('settings.server.set', { serverUrl: 'https://new.example.com/' })).resolves.toMatchObject({
        ok: true,
        value: {
          config: { serverUrl: 'https://new.example.com' },
          applies: 'live',
        },
      })
      expect(ctx.get('dshRemote')).toBe(foreignHostService)
      expect(ctx.get('dshRemoteClient')).toBe(foreignClientService)

      await foreignFiber.dispose()
      await expect(call('settings.server.set', { serverUrl: 'https://third.example.com/' })).resolves.toMatchObject({
        ok: true,
        value: {
          config: { serverUrl: 'https://third.example.com' },
          applies: 'live',
        },
      })
      expect(ctx.dshRemote.currentIdentity()).toBeDefined()
      expect(ctx.dshRemoteClient.status().serverUrl).toBe('https://third.example.com')
    } finally {
      await fiber.dispose()
      await foreignFiber.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('surfaces pre-registration startup failures on control status, settings, and HostLogStore', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-prereg-failure-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)
    vi.stubEnv('DSH_PROFILE', 'pre-fail')

    let registeredRoute: {
      path: string
      auth?: string
      handler(req: unknown, res: unknown): Promise<void> | void
    } | undefined
    const ctx = new Context()
    ctx.provide('settings', settings({}))
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', { admit: () => ({ peer: {} }), rpc: {} } as never)
    ctx.provide('webServer', {
      register: (route: typeof registeredRoute) => {
        registeredRoute = route
        return async () => undefined
      },
    } as never)

    const fiber = await ctx.plugin(remotePlugin, {
      ...disabledAgentDomains,
      httpServerAllowlist: ['http://invalid-entry'],
    })
    const callHttp = async (method: string) => {
      const { Readable } = await import('node:stream')
      const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({
        type: 'client-request', rpcId: 'req-1', method, payload: {},
      }))]), {
        method: 'POST',
        url: `/ds-harness-remote/${method}`,
        headers: { 'content-type': 'application/json' },
      })
      let status = 0
      let text = ''
      await registeredRoute!.handler(req, {
        writeHead: (code: number) => { status = code },
        end: (chunk?: unknown) => { if (chunk !== undefined) text += String(chunk) },
      })
      return { status, body: JSON.parse(text) }
    }

    try {
      await vi.waitFor(() => expect(registeredRoute?.path).toBe('/ds-harness-remote'))
      expect(registeredRoute?.auth).toBe('required')
      await expect(callHttp('status')).resolves.toMatchObject({
        status: 200,
        body: {
          result: {
            ok: true,
            value: {
              available: false,
              controlUnavailable: false,
              startupError: { code: 'INTERNAL_ERROR' },
            },
          },
        },
      })
      await expect(callHttp('settings.get')).resolves.toMatchObject({
        status: 200,
        body: {
          result: {
            ok: true,
            value: {
              startupError: { code: 'INTERNAL_ERROR' },
            },
          },
        },
      })
      const logsRes = await callHttp('settings.logs.get')
      expect(logsRes.body.result).toMatchObject({ ok: true })
      expect(logsRes.body.result.value.entries.some((entry: { line: string }) =>
        entry.line.includes('Remote plugin startup failed'))).toBe(true)
    } finally {
      await fiber.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('mounts late webServer and survives webServer reloads without restarting Host runtime', async () => {
    const { runScenarios } = await import('../../../scripts/test-scenarios.mjs')
    await runScenarios([true, false].map(enabled => ({
      name: enabled ? 'enabled' : 'disabled',
      run: async () => {
        const dshHome = await mkdtemp(join(tmpdir(), `dsh-remote-late-ws-${enabled ? 'on' : 'off'}-`))
        directories.push(dshHome)
        vi.stubEnv('DSH_HOME', dshHome)

        let rpcMounts = 0
        let rpcDisposals = 0
        const ctx = new Context()
        ctx.provide('settings', settings({ enabled, deviceName: 'Late WebServer Host' }))
        ctx.provide('typertGateway', typertGateway())
        ctx.provide('connection', {
          rpc: {
            handle: vi.fn(() => {
              rpcMounts += 1
              return async () => { rpcDisposals += 1 }
            }),
          },
        } as never)

        const fiber = await ctx.plugin(remotePlugin, { ...disabledAgentDomains, enabled })
        try {
          await vi.waitFor(() => {
            expect(rpcMounts).toBe(1)
            if (enabled) expect(ctx.dshRemote.currentIdentity()).toBeDefined()
          })
          const initialHost = enabled ? ctx.dshRemote : undefined
          const initialDeviceId = initialHost?.currentIdentity().deviceId

          const ws1Disposed = vi.fn()
          let ws1Route: { handler(req: unknown, res: unknown): Promise<void> | void } | undefined
          const ws1Fiber = await ctx.plugin({
            name: 'mock-ws-1',
            apply(peerCtx: Context) {
              peerCtx.provide('webServer', {
                register: (route: typeof ws1Route) => {
                  ws1Route = route
                  return async () => { ws1Disposed() }
                },
              } as never)
            },
          })

          await vi.waitFor(() => {
            expect(ws1Route).toBeDefined()
            expect(rpcDisposals).toBe(1)
          })
          if (enabled) {
            expect(ctx.dshRemote).toBe(initialHost)
            expect(ctx.dshRemote.currentIdentity().deviceId).toBe(initialDeviceId)
          }

          await ws1Fiber.dispose()
          await vi.waitFor(() => {
            expect(ws1Disposed).toHaveBeenCalledOnce()
            expect(rpcMounts).toBe(2)
          })

          const ws2Disposed = vi.fn()
          let ws2RouteRegistered = false
          const ws2Fiber = await ctx.plugin({
            name: 'mock-ws-2',
            apply(peerCtx: Context) {
              peerCtx.provide('webServer', {
                register: () => {
                  ws2RouteRegistered = true
                  return async () => { ws2Disposed() }
                },
              } as never)
            },
          })

          await vi.waitFor(() => {
            expect(ws2RouteRegistered).toBe(true)
            expect(rpcDisposals).toBe(2)
          })

          await fiber.dispose()
          expect(ws2Disposed).toHaveBeenCalledOnce()
          await ws2Fiber.dispose()
        } finally {
          await ctx.fiber.dispose()
        }
      },
    })))
  })

  it('resolves log profile name from profileContext, baseUrl, and Symbol.for(cordis.root)', async () => {
    const { runScenarios } = await import('../../../scripts/test-scenarios.mjs')
    await runScenarios(['profileContext', 'baseUrl', 'nonProfileCtxBaseUrl', 'symbolRoot', 'throwingSymbolRoot'].map(mode => ({
      name: mode,
      run: async () => {
        const dshHome = await mkdtemp(join(tmpdir(), `dsh-remote-profile-${mode}-`))
        directories.push(dshHome)
        vi.stubEnv('DSH_HOME', dshHome)
        vi.stubEnv('DSH_PROFILE', '')

        let handler!: ControlRouteHandler
        const ctx = new Context()
        ctx.provide('settings', settings({ deviceName: 'Profile Resolve Host' }))
        ctx.provide('typertGateway', typertGateway())
        ctx.provide('connection', {
          rpc: {
            handle: (_ch: string, fn: ControlRouteHandler) => {
              handler = fn
              return async () => undefined
            },
          },
        } as never)

        if (mode === 'profileContext') {
          ctx.provide('profileContext', { name: 'desktop-ctx' } as never)
        } else if (mode === 'baseUrl') {
          (ctx as { baseUrl?: string }).baseUrl = 'file:///tmp/user/.dsh/profiles/desktop-url/'
        } else if (mode === 'nonProfileCtxBaseUrl') {
          const fakeRoot = Object.assign(new Context(), {
            baseUrl: 'file:///C:/Users/Alice%20Smith/.dsh/profiles/root-url/',
          })
          Reflect.set(ctx, Symbol.for('cordis.root'), fakeRoot)
          ;(ctx as { baseUrl?: string }).baseUrl = 'file:///C:/app/plugins/ds-harness-remote/index.js'
        } else if (mode === 'symbolRoot') {
          const fakeRoot = Object.assign(new Context(), {
            baseDir: '/tmp/user/.dsh/profiles/sym-prof',
          })
          Reflect.set(ctx, Symbol.for('cordis.root'), fakeRoot)
          Object.defineProperty(ctx, 'root', {
            configurable: true,
            get() { throw new Error('cannot get property "root" without inject') },
          })
        } else {
          Object.defineProperty(ctx, Symbol.for('cordis.root'), {
            configurable: true,
            get() { throw new Error('throwing cordis.root symbol getter') },
          })
          ;(ctx as { baseUrl?: string }).baseUrl = 'file:///tmp/user/.dsh/profiles/sym-fallback/'
        }

        const expectedFile = mode === 'profileContext'
          ? 'desktop-ctx.log'
          : mode === 'baseUrl'
            ? 'desktop-url.log'
            : mode === 'nonProfileCtxBaseUrl'
              ? 'root-url.log'
              : mode === 'symbolRoot'
                ? 'sym-prof.log'
                : 'sym-fallback.log'

        const fiber = await ctx.plugin(remotePlugin, disabledAgentDomains)
        try {
          await vi.waitFor(() => expect(handler).toBeDefined())
          const logs = await handler('settings.logs.get', {}, new AbortController().signal) as {
            ok: boolean
            value?: { filePath?: string }
          }
          expect(logs.ok).toBe(true)
          expect(logs.value?.filePath).toBe(join(dshHome, 'logs', 'ds-harness-remote', expectedFile))
        } finally {
          await fiber.dispose()
          await ctx.fiber.dispose()
        }
      },
    })))
  })

  it('recovers RPC fallback route when webServer disappears pre-reload or its disposer throws', async () => {
    const { runScenarios } = await import('../../../scripts/test-scenarios.mjs')
    await runScenarios(['vanishingWebServer', 'throwingDisposer'].map(mode => ({
      name: mode,
      run: async () => {
        const dshHome = await mkdtemp(join(tmpdir(), `dsh-remote-ws-edge-${mode}-`))
        directories.push(dshHome)
        vi.stubEnv('DSH_HOME', dshHome)

        let rpcMounts = 0
        const ctx = new Context()
        ctx.provide('settings', settings({ enabled: false }))
        ctx.provide('typertGateway', typertGateway())
        ctx.provide('connection', {
          rpc: {
            handle: vi.fn(() => {
              rpcMounts += 1
              return async () => undefined
            }),
          },
        } as never)

        const wsFiber = await ctx.plugin({
          name: 'mock-ws-edge',
          apply(peerCtx: Context) {
            peerCtx.provide('webServer', {
              register: () => async () => {
                if (mode === 'throwingDisposer') throw new Error('ws dispose boom')
              },
            } as never)
          },
        })

        const fiber = await ctx.plugin(remotePlugin, { ...disabledAgentDomains, enabled: false })
        try {
          if (mode === 'vanishingWebServer') {
            await wsFiber.dispose()
            await vi.waitFor(() => expect(rpcMounts).toBe(1))
          } else {
            await vi.waitFor(() => expect(rpcMounts).toBe(0))
            await new Promise(resolve => setTimeout(resolve, 25))
            await wsFiber.dispose()
            await vi.waitFor(() => expect(rpcMounts).toBe(1))
          }
        } finally {
          await fiber.dispose()
          await ctx.fiber.dispose()
        }
      },
    })))
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
