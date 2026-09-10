import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostAuthorizationControl, HostConnectionHandle } from '../src/client-runtime.js'
import { resolveConfig, type Config } from '../src/config.js'
import { CONTROL_RPC_PREFIX } from '../src/control-route.js'
import { PluginControlRuntime } from '../src/control-runtime.js'
import { serverStorageDirectory } from '../src/identity-store.js'

const directories: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('PluginControlRuntime settings setup', () => {
  it('coexists with a Remote Web UI that already owns /remote', async () => {
    const channels = new Set(['/remote'])
    const connection = {
      rpc: {
        handle: vi.fn((channel: string) => {
          if (channels.has(channel)) throw new Error(`webserver: duplicate prefix route "${channel}"`)
          channels.add(channel)
          return async () => { channels.delete(channel) }
        }),
      },
    } as unknown as HostConnectionHandle
    const runtime = new PluginControlRuntime(
      resolveConfig(), '/unused', undefined, undefined, undefined,
    )

    const dispose = runtime.register(connection)

    expect(channels).toEqual(new Set(['/remote', CONTROL_RPC_PREFIX]))
    await dispose()
    expect(channels).toEqual(new Set(['/remote']))
  })

  it('registers loopback control directly on webServer when dsh-v0.1.5 exposes request rejection', async () => {
    const legacyHandle = vi.fn(() => async () => undefined)
    const requestRejection = vi.fn(() => undefined)
    const registerRoute = vi.fn(() => async () => undefined)
    const runtime = new PluginControlRuntime(
      resolveConfig(), '/unused', undefined, undefined, undefined,
    )

    const dispose = runtime.register({
      requestRejection,
      rpc: { handle: legacyHandle },
    } as unknown as HostConnectionHandle, {
      register: registerRoute,
    })

    expect(legacyHandle).not.toHaveBeenCalled()
    expect(registerRoute).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'prefix',
      path: CONTROL_RPC_PREFIX,
      handler: expect.any(Function),
    }))
    await dispose()
  })

  it('updates the Server address without creating a separate authorization', async () => {
    const directory = await temporaryDirectory()
    const settings = settingsScope({
      serverUrl: 'https://old.example.com',
      role: 'client',
      codex: { enabled: true, binary: '/opt/codex' },
    })
    const handler = register(new PluginControlRuntime(
      resolveConfig(settings.get()), directory, settings, undefined, undefined,
    ))

    await expect(handler('settings.server.set', {
      serverUrl: 'https://remote.example.com/',
    }, signal())).resolves.toMatchObject({
      ok: true,
      value: {
        config: {
          serverUrl: 'https://remote.example.com',
          codex: { enabled: true, binary: '/opt/codex' },
        },
        associations: {},
        applies: 'restart',
      },
    })
    expect(settings.get()).toMatchObject({
      serverUrl: 'https://remote.example.com',
      role: 'client',
      codex: { enabled: true, binary: '/opt/codex' },
    })

    await expect(handler('settings.codex.set', { enabled: false }, signal())).resolves.toMatchObject({
      ok: true,
      value: { config: { codex: { enabled: false, binary: '/opt/codex' } } },
    })
    expect(settings.get()).toMatchObject({ codex: { enabled: false, binary: '/opt/codex' } })
  })

  it('exposes Host activity and starts a manual reconnect through loopback control', async () => {
    const reconnectHost = vi.fn()
    const host = {
      hostStatus: vi.fn(() => ({
        configured: true,
        online: false,
        reconnecting: true,
        lastActiveAt: 1_723_456_789_000,
        error: 'CONNECTION_FAILED',
        authorized: false,
        accountRequired: false,
      })),
      reconnectHost,
      clearHostAuthorization: vi.fn(),
      authorizeHostAsOwned: vi.fn(),
      authorizeHostWithAccount: vi.fn(),
      authorizeHostWithCode: vi.fn(),
    } satisfies HostAuthorizationControl
    const handler = register(new PluginControlRuntime(
      resolveConfig({ serverUrl: 'https://dsh.r2049.cn' }), '/unused', undefined, undefined, host,
    ))

    await expect(handler('host.reconnect', {}, signal())).resolves.toMatchObject({
      ok: true,
      value: {
        host: {
          reconnecting: true,
          lastActiveAt: 1_723_456_789_000,
          error: 'CONNECTION_FAILED',
        },
      },
    })
    expect(reconnectHost).toHaveBeenCalledOnce()
  })

  it('authorizes a Host before saving its Server and role without persisting the password', async () => {
    const directory = await temporaryDirectory()
    const settings = settingsScope({ serverUrl: 'https://old.example.com', role: 'client' })
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/auth/login')) return json({
        token: 'web-account-token-value',
        expiresAt: Date.now() + 600_000,
        account: 'host@example.com',
        profile: {},
        isAdmin: false,
      })
      if (url.endsWith('/devices/register')) return json(tokens())
      if (url.endsWith('/devices/register-owned-role')) return json(tokens({
        accessToken: 'client-access-token-value',
        refreshToken: 'client-refresh-token-value',
      }))
      throw new Error(`unexpected request: ${url}`)
    }))
    const handler = register(new PluginControlRuntime(
      resolveConfig(settings.get()), directory, settings, undefined, undefined,
    ))

    const result = await handler('settings.configure', {
      role: 'host',
      serverUrl: 'https://dsh.r2049.cn/',
      email: 'host@example.com',
      password: 'correct horse battery staple',
    }, signal())

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'authorized',
        role: 'host',
        account: 'host@example.com',
        settings: { association: { method: 'account', account: 'host@example.com' } },
      },
    })
    expect(settings.get()).toMatchObject({ role: 'host', serverUrl: 'https://dsh.r2049.cn' })
    expect(settings.get()).not.toHaveProperty('deviceName')
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({ device: { name: hostname(), role: 'host' } })
    expect(JSON.stringify(settings.get())).not.toContain('correct horse battery staple')

    await expect(handler('settings.role.set', { role: 'client' }, signal())).resolves.toMatchObject({
      ok: true,
      value: {
        config: { role: 'client' },
        association: { method: 'owned_device', account: 'host@example.com' },
        associations: {
          host: { method: 'account', account: 'host@example.com' },
          client: { method: 'owned_device', account: 'host@example.com' },
        },
      },
    })
    expect(calls).toHaveLength(3)
    expect(calls[2]?.url).toBe('https://dsh.r2049.cn/api/v1/devices/register-owned-role')
    expect(calls[2]?.init?.headers).toMatchObject({ Authorization: 'Bearer access-token-value' })
    expect(JSON.parse(String(calls[2]?.init?.body))).toMatchObject({ device: { role: 'client' } })
    const hostDirectory = serverStorageDirectory(directory, 'https://dsh.r2049.cn', 'host')
    const clientDirectory = serverStorageDirectory(directory, 'https://dsh.r2049.cn', 'client')
    await expect(readFile(join(hostDirectory, 'server-credentials.json'), 'utf8')).resolves.toContain('host@example.com')
    await expect(readFile(join(clientDirectory, 'server-credentials.json'), 'utf8')).resolves.toContain('owned_device')
    await expect(handler('settings.role.set', { role: 'host' }, signal())).resolves.toMatchObject({
      ok: true,
      value: { association: { account: 'host@example.com' } },
    })
    expect(calls).toHaveLength(3)
    await expect(handler('settings.logout', {}, signal())).resolves.toMatchObject({
      ok: true,
      value: { config: { role: 'host' }, associations: {} },
    })
    await expect(readFile(join(hostDirectory, 'server-credentials.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(clientDirectory, 'server-credentials.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('authorizes a Client with its site account and persists only device credentials', async () => {
    const directory = await temporaryDirectory()
    const settings = settingsScope({})
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/auth/login')) return json({
        token: 'web-account-token-value',
        expiresAt: Date.now() + 600_000,
        account: 'client@example.com',
        profile: {},
        isAdmin: false,
      })
      if (url.endsWith('/devices/register')) return json(tokens())
      throw new Error(`unexpected request: ${url}`)
    }))
    const handler = register(new PluginControlRuntime(
      resolveConfig(settings.get()), directory, settings, undefined, undefined,
    ))

    const configured = await handler('settings.configure', {
      role: 'client',
      serverUrl: 'https://dsh.r2049.cn',
      email: 'client@example.com',
      password: 'correct horse battery staple',
    }, signal())
    expect(configured).toMatchObject({
      ok: true,
      value: {
        status: 'authorized',
        role: 'client',
        account: 'client@example.com',
        settings: { association: { method: 'account', account: 'client@example.com' } },
      },
    })
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({ device: { name: hostname(), role: 'client' } })
    const clientDirectory = serverStorageDirectory(directory, 'https://dsh.r2049.cn', 'client')
    const stored = await readFile(join(clientDirectory, 'server-credentials.json'), 'utf8')
    expect(stored).toContain('client@example.com')
    expect(stored).not.toContain('correct horse battery staple')
    expect(stored).not.toContain('web-account-token-value')
  })

  it('authorizes a Host with a website-generated one-time registration code', async () => {
    const directory = await temporaryDirectory()
    const settings = settingsScope({})
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return json(tokens())
    }))
    const handler = register(new PluginControlRuntime(
      resolveConfig(settings.get()), directory, settings, undefined, undefined,
    ))

    const configured = await handler('settings.configure', {
      role: 'host',
      serverUrl: 'https://dsh.r2049.cn',
      registrationCode: 'ABCD-EFGH',
    }, signal())

    expect(configured).toMatchObject({
      ok: true,
      value: {
        status: 'authorized',
        role: 'host',
        settings: { association: { method: 'host_registration_code' } },
      },
    })
    expect(calls[0]?.url).toBe('https://dsh.r2049.cn/api/v1/devices/register-with-code')
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      code: 'ABCD-EFGH',
      device: { name: hostname(), role: 'host' },
    })

    await expect(handler('settings.role.set', { role: 'client' }, signal())).resolves.toMatchObject({
      ok: true,
      value: {
        config: { role: 'client' },
        association: { method: 'owned_device' },
      },
    })
    expect(calls[1]?.url).toBe('https://dsh.r2049.cn/api/v1/devices/register-owned-role')
    expect(calls[1]?.init?.headers).toMatchObject({ Authorization: 'Bearer access-token-value' })
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({
      device: { name: hostname(), role: 'client' },
    })
  })
})

function register(runtime: PluginControlRuntime) {
  let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>) | undefined
  let channel: string | undefined
  runtime.register({
    rpc: {
      handle: (registeredChannel, next) => {
        channel = registeredChannel
        handler = next
        return async () => undefined
      },
    },
  } satisfies HostConnectionHandle)
  expect(channel).toBe(CONTROL_RPC_PREFIX)
  if (handler === undefined) throw new Error('control handler was not registered')
  return handler
}

function settingsScope(initial: Config): SettingsScope<Config> {
  let value = structuredClone(initial)
  return {
    get: () => structuredClone(value),
    watch: () => () => undefined,
    update: async patch => { value = { ...value, ...patch } },
    replace: async section => { value = structuredClone(section as Config) },
  }
}

function signal(): AbortSignal { return new AbortController().signal }

function tokens(overrides: Partial<ReturnType<typeof baseTokens>> = {}) {
  return { ...baseTokens(), ...overrides }
}

function baseTokens() {
  return {
    accessToken: 'access-token-value',
    accessTokenExpiresAt: Date.now() + 600_000,
    refreshToken: 'refresh-token-value',
    refreshTokenExpiresAt: Date.now() + 86_400_000,
  }
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-control-'))
  directories.push(directory)
  return directory
}
