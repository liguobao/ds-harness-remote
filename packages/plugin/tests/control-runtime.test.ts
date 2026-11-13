import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ControlResult } from '../src/control-result.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostAuthorizationControl, HostConnectionHandle } from '../src/client-runtime.js'
import type { ClientModeRuntime } from '../src/client-runtime.js'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { resolveConfig, type Config } from '../src/config.js'
import { CONTROL_RPC_PREFIX } from '../src/control-route.js'
import { PluginControlRuntime, type PluginSettingsBinding } from '../src/control-runtime.js'
import { IdentityInvalidError, IdentityStore, serverStorageDirectory } from '../src/identity-store.js'
import { ServerCredentialStore } from '../src/server-credentials.js'

const directories: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('PluginControlRuntime settings setup', () => {
  it('persists debug logging and rejects invalid switches without changing other settings', async () => {
    const settings = settingsBinding({ terminal: { enabled: false }, logLevel: 'warn' })
    const handler = register(new PluginControlRuntime(resolveConfig(settings.get()), await temporaryDirectory(), settings, undefined, undefined))
    expect(await handler('settings.development.set', { debugLogging: true }, signal())).toMatchObject({ ok: true })
    expect(settings.get()).toMatchObject({ logLevel: 'debug', terminal: { enabled: false } })
    expect(await handler('settings.development.set', { debugLogging: 'true' }, signal())).toMatchObject({ ok: false })
    expect(settings.get().logLevel).toBe('debug')
    expect(await handler('settings.development.set', { debugLogging: false }, signal())).toMatchObject({ ok: true })
    expect(settings.get().logLevel).toBe('info')
  })

  it('keeps pairing on local Host control and refuses Host-only role escalation', async () => {
    const directory = await temporaryDirectory()
    const settings = settingsBinding({ serverUrl: 'https://dsh.r2049.cn' })
    const pairingControl = vi.fn(async () => ({ state: 'claimed', localSaved: false }))
    const clientControl = vi.fn(async () => ({ ok: true, value: {} }))
    const host = { hostStatus: () => ({ pairingHostOnly: true }), pairingControl } as unknown as HostAuthorizationControl
    const handler = register(new PluginControlRuntime(resolveConfig(settings.get()), directory, settings,
      { handleControl: clientControl } as unknown as ClientModeRuntime, host))
    await expect(handler('host.pairing.confirm', { sessionId: 'specific-session', verificationCode: '00123456' }, signal())).resolves.toMatchObject({ ok: true })
    expect(pairingControl).toHaveBeenCalledWith('confirm', { sessionId: 'specific-session', verificationCode: '00123456' })
    expect(clientControl).not.toHaveBeenCalled()
    await expect(handler('settings.role.set', { role: 'client' }, signal())).resolves.toMatchObject({ ok: false, error: { details: { remoteCode: 'DEVICE_SCOPE_REQUIRED' } } })
    await expect(handler('settings.configure', { role: 'client', serverUrl: 'https://dsh.r2049.cn', email: 'test@example.test', password: 'password' }, signal())).resolves.toMatchObject({ ok: false })
  })

  it('holds login discovery until Server replacement settles and rejects overlapping saves', async () => {
    await runScenarios([false, true].map(fails => ({ name: fails ? 'replacement fails' : 'replacement succeeds', run: async () => {
      const directory = await temporaryDirectory()
      const settings = settingsBinding({ serverUrl: 'https://old.example.com' })
      let release!: () => void
      let started!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const ready = new Promise<void>(resolve => { started = resolve })
      const oldHandle = vi.fn(async () => ({ ok: true, value: ['old'] }))
      const newHandle = vi.fn(async () => ({ ok: true, value: ['new'] }))
      const handler = register(new PluginControlRuntime(resolveConfig(settings.get()), directory, settings,
        { handleControl: oldHandle } as unknown as ClientModeRuntime, undefined, async () => {
          started()
          await gate
          if (fails) throw new Error('replacement failed')
          return { client: { handleControl: newHandle } as unknown as ClientModeRuntime, host: {} as HostAuthorizationControl }
        }))
      const saving = handler('settings.server.set', { serverUrl: 'https://new.example.com' }, signal())
      await ready
      const providers = handler('client.account.providers', {}, signal())
      try {
        await expect(handler('settings.server.set', { serverUrl: 'https://other.example.com' }, signal())).resolves.toMatchObject({
          ok: false, error: { details: { remoteCode: 'SERVER_SWITCH_BUSY' } },
        })
        expect(oldHandle).not.toHaveBeenCalled()
        expect(newHandle).not.toHaveBeenCalled()
        release()
        await expect(saving).resolves.toMatchObject({ ok: !fails })
        await expect(providers).resolves.toMatchObject(fails ? { ok: false } : { ok: true, value: ['new'] })
        expect(oldHandle).not.toHaveBeenCalled()
        expect(newHandle).toHaveBeenCalledTimes(fails ? 0 : 1)
      } finally {
        release()
        await Promise.allSettled([saving, providers])
      }
    } })))
  })

  it('finishes both roles and credential cleanup in one shared sign-out even when one revocation fails', async () => {
    await runScenarios((['client', 'host'] as const).map(failingRole => ({ name: failingRole, run: async () => {
      const directory = await temporaryDirectory()
      const settings = settingsBinding({ serverUrl: 'https://dsh.r2049.cn' })
      const stores = (['client', 'host'] as const).map(role => new ServerCredentialStore(
        serverStorageDirectory(directory, 'https://dsh.r2049.cn', role),
      ))
      for (const store of stores) await store.save({
        serverUrl: 'https://dsh.r2049.cn', deviceId: 'old-device', authorizationMethod: 'account', ...tokens(),
      })
      let release!: () => void
      let started!: () => void
      const ready = new Promise<void>(resolve => { started = resolve })
      const gate = new Promise<void>(resolve => { release = resolve })
      const clear = (role: 'host' | 'client') => vi.fn(async () => {
        if (role === failingRole) throw new Error('revocation failed')
        started()
        await gate
      })
      const client = { clearClientAuthorization: clear('client') }
      const host = { clearHostAuthorization: clear('host') }
      const handler = register(new PluginControlRuntime(resolveConfig(settings.get()), directory, settings,
        client as unknown as ClientModeRuntime, host as unknown as HostAuthorizationControl))
      let completed = false
      const first = handler('settings.logout', {}, signal()).then(result => { completed = true; return result })
      await ready
      const second = handler('settings.logout', {}, signal())
      await Promise.resolve()
      expect(completed).toBe(false)
      release()
      for (const result of await Promise.all([first, second])) expect(result).toMatchObject({ ok: false })
      expect(client.clearClientAuthorization).toHaveBeenCalledOnce()
      expect(host.clearHostAuthorization).toHaveBeenCalledOnce()
      for (const store of stores) await expect(store.load('https://dsh.r2049.cn', 'old-device')).resolves.toBeUndefined()
      await expect(handler('settings.get', {}, signal())).resolves.toMatchObject({ ok: true, value: { associations: {} } })
    } })))
  })

  it('applies backend settings to the running Host after persistence', async () => {
    const directory = await temporaryDirectory()
    const settings = settingsBinding({ acp: { enabled: true, backends: [{ id: 'codex', enabled: false }] } })
    const apply = vi.fn(async (config: ReturnType<typeof resolveConfig>) => {
      expect(resolveConfig(settings.get()).codex.enabled).toBe(config.codex.enabled)
    })
    const handler = register(new PluginControlRuntime(resolveConfig(settings.get()), directory, settings, undefined, { setAgentBackends: apply } as unknown as HostAuthorizationControl))
    await expect(handler('settings.acp.set', { backend: 'codex', enabled: true }, signal())).resolves.toMatchObject({ ok: true, value: { applies: 'live' } })
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply.mock.calls[0]?.[0].codex.enabled).toBe(true)
  })

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
    const settings = settingsBinding({
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

    await expect(handler('settings.acp.set', { backend: 'codex', enabled: true }, signal())).resolves.toMatchObject({ ok: true })
    expect(resolveConfig(settings.get()).codex.enabled).toBe(true)
    await handler('settings.acp.set', { backend: 'codex', enabled: false }, signal())
    expect(resolveConfig(settings.get()).codex.enabled).toBe(false)

    await expect(handler('settings.cursor.set', { enabled: true }, signal())).resolves.toMatchObject({
      ok: true,
      value: { config: { cursor: { enabled: true, binary: 'agent' } } },
    })
    expect(settings.get()).toMatchObject({ cursor: { enabled: true, binary: 'agent' } })
    expect(resolveConfig(settings.get()).acp?.backends.find(item => item.id === 'cursor')?.enabled).toBe(true)
    await expect(handler('settings.acp.set', { backend: 'cursor', enabled: false }, signal())).resolves.toMatchObject({ ok: true })
    const before = resolveConfig(settings.get()).acp!
    const seed = structuredClone(settings.get()) as Config
    await settings.replace({ ...seed, acp: { ...before, enabled: false } })
    await expect(handler('settings.acp.set', { backend: 'antigravity', enabled: true }, signal())).resolves.toMatchObject({ ok: true })
    const after = resolveConfig(settings.get()).acp!
    expect(after.enabled).toBe(true)
    expect(after.backends.find(item => item.id === 'antigravity')?.enabled).toBe(true)
    expect(after.backends.find(item => item.id === 'cursor')?.enabled).toBe(false)
    await expect(handler('settings.acp.set', { backend: 'unknown-backend', enabled: true }, signal())).resolves.toMatchObject({ ok: false })

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
    const settings = settingsBinding({ serverUrl: 'https://old.example.com', role: 'client' })
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
    const settings = settingsBinding({})
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
    const settings = settingsBinding({})
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
  it('surfaces startup failure in status and settings without disabling control plane', async () => {
    const root = await temporaryDirectory()
    const settings = settingsBinding({ serverUrl: 'https://dsh.r2049.cn' })
    const control = new PluginControlRuntime(resolveConfig(settings.get()), root, settings, undefined, undefined)
    const handler = register(control)

    control.setStartupFailure(new IdentityInvalidError('device public and private keys do not match'))

    const statusResult = await handler('status', {}, signal())
    expect(statusResult).toMatchObject({
      ok: true,
      value: {
        mode: 'local',
        available: false,
        controlUnavailable: false,
        startupError: {
          code: 'IDENTITY_INVALID',
          message: 'device public and private keys do not match',
        },
      },
    })

    const settingsResult = await handler('settings.get', {}, signal())
    expect(settingsResult).toMatchObject({
      ok: true,
      value: {
        startupError: {
          code: 'IDENTITY_INVALID',
          message: 'device public and private keys do not match',
        },
      },
    })
  })

  it('retries startup after storage repair without changing settings', async () => {
    const root = await temporaryDirectory()
    const settings = settingsBinding({ serverUrl: 'https://dsh.r2049.cn' })
    const replace = vi.spyOn(settings, 'replace')
    let repaired = false
    const switchServer = vi.fn(async () => {
      if (!repaired) throw new IdentityInvalidError('Storage still conflicts', 'STORAGE_CONFLICT')
      return { client: undefined, host: {
        hostStatus: () => ({ configured: true, online: true, reconnecting: false, authorized: true, accountRequired: false }),
        reconnectHost: vi.fn(),
      } as unknown as HostAuthorizationControl }
    })
    const control = new PluginControlRuntime(resolveConfig(settings.get()), root, settings, undefined, undefined, switchServer)
    const handler = register(control)
    control.setStartupFailure(new IdentityInvalidError('Storage conflicts', 'STORAGE_CONFLICT'))

    await expect(handler('settings.startup.retry', {}, signal())).resolves.toMatchObject({
      ok: false, error: { details: { remoteCode: 'STORAGE_CONFLICT' } },
    })
    expect((await handler('status', {}, signal()) as any).value?.startupError?.code).toBe('STORAGE_CONFLICT')

    repaired = true
    await expect(handler('settings.startup.retry', {}, signal())).resolves.toMatchObject({ ok: true })
    const status = await handler('status', {}, signal())
    expect((status as any).value?.startupError).toBeUndefined()
    expect((status as any).value?.host?.online).toBe(true)
    expect(switchServer).toHaveBeenCalledTimes(2)
    expect(replace).not.toHaveBeenCalled()
    expect(settings.get().serverUrl).toBe('https://dsh.r2049.cn')
  })

  it('rejects a second startup retry while the first Server switch is in progress', async () => {
    const root = await temporaryDirectory()
    const settings = settingsBinding({ serverUrl: 'https://dsh.r2049.cn' })
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const ready = new Promise<void>(resolve => { started = resolve })
    const switchServer = vi.fn(async () => {
      started()
      await gate
      return { client: undefined, host: {
        hostStatus: () => ({ configured: true, online: true, reconnecting: false, authorized: true, accountRequired: false }),
      } as unknown as HostAuthorizationControl }
    })
    const control = new PluginControlRuntime(resolveConfig(settings.get()), root, settings, undefined, undefined, switchServer)
    const handler = register(control)
    control.setStartupFailure(new IdentityInvalidError('Storage conflicts', 'STORAGE_CONFLICT'))

    const first = handler('settings.startup.retry', {}, signal())
    await ready
    try {
      await expect(handler('settings.startup.retry', {}, signal())).resolves.toMatchObject({
        ok: false, error: { details: { remoteCode: 'SERVER_SWITCH_BUSY' } },
      })
      expect(switchServer).toHaveBeenCalledOnce()
    } finally {
      release()
    }
    await expect(first).resolves.toMatchObject({ ok: true })
    expect(switchServer).toHaveBeenCalledOnce()
  })

  it('resets identity, validates role payload, and preserves startupError if restart still fails', async () => {
    const root = await temporaryDirectory()
    const serverUrl = 'https://dsh.r2049.cn'
    const settings = settingsBinding({ serverUrl })
    let shouldFailRestart = true
    const switchServer = vi.fn(async () => {
      if (shouldFailRestart) {
        throw new IdentityInvalidError('device public and private keys do not match')
      }
      return {
        client: undefined,
        host: {
          hostStatus: () => ({ configured: true, online: true, reconnecting: false, authorized: true, accountRequired: false }),
          reconnectHost: vi.fn(),
          clearHostAuthorization: vi.fn(),
          authorizeHostAsOwned: vi.fn(),
          authorizeHostWithAccount: vi.fn(),
          authorizeHostWithCode: vi.fn(),
        } satisfies HostAuthorizationControl,
      }
    })

    const control = new PluginControlRuntime(resolveConfig(settings.get()), root, settings, undefined, undefined, switchServer)
    const handler = register(control)
    control.setStartupFailure(new IdentityInvalidError('device public and private keys do not match'))

    await expect(handler('settings.identity.reset', { role: 'invalid-role' }, signal())).resolves.toMatchObject({
      ok: false,
      error: { details: { remoteCode: 'INVALID_MESSAGE' } },
    })
    expect(switchServer).not.toHaveBeenCalled()

    await expect(handler('settings.identity.reset', { role: 'host' }, signal())).resolves.toMatchObject({
      ok: false,
      error: { details: { remoteCode: 'IDENTITY_INVALID' } },
    })
    const statusWhileBroken = await handler('status', {}, signal())
    expect((statusWhileBroken as any).value?.startupError).toMatchObject({
      code: 'IDENTITY_INVALID',
      message: 'device public and private keys do not match',
    })

    shouldFailRestart = false
    const result = await handler('settings.identity.reset', { role: 'all' }, signal())
    expect(result).toMatchObject({ ok: true })
    expect(switchServer).toHaveBeenCalledTimes(2)

    const statusAfter = await handler('status', {}, signal())
    expect((statusAfter as any).value?.startupError).toBeUndefined()
  })

  it('tolerates corrupt identity or credentials in settingsView without throwing or creating files', async () => {
    const root = await temporaryDirectory()
    const serverUrl = 'https://dsh.r2049.cn'
    const settings = settingsBinding({ serverUrl })
    const hostDir = serverStorageDirectory(root, serverUrl, 'host')
    const clientDir = serverStorageDirectory(root, serverUrl, 'client')
    await new IdentityStore({ directory: clientDir, role: 'client' }).loadOrCreate('Client')
    const { writeFile, stat } = await import('node:fs/promises')
    await writeFile(join(clientDir, 'device.key'), 'corrupted-key\n')
    await new ServerCredentialStore(clientDir).save({
      serverUrl,
      deviceId: 'client-id',
      authorizationMethod: 'owned_device',
      accessToken: 'a'.repeat(24),
      accessTokenExpiresAt: Date.now() + 60000,
      refreshToken: 'r'.repeat(24),
      refreshTokenExpiresAt: Date.now() + 600000,
    })

    const control = new PluginControlRuntime(resolveConfig(settings.get()), root, settings, undefined, undefined)
    const handler = register(control)

    const view = await handler('settings.get', {}, signal())
    expect(view).toMatchObject({ ok: true, value: { deviceName: expect.any(String) } })
    expect((view as any).value?.associations?.client).toBeUndefined()
    await expect(stat(join(hostDir, 'device.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('PluginControlRuntime local log endpoints', () => {
  it('reads and clears Host logs locally even when startup failed and validates parameters', async () => {
    const { HostLogStore } = await import('../src/host-log-store.js')
    const directory = await temporaryDirectory()
    const logFile = join(directory, 'logs', 'ds-harness-remote', 'web.log')
    const logStore = new HostLogStore({ filePath: logFile })
    logStore.record('info', '[ds-harness-remote] boot')
    logStore.record('warn', '[ds-harness-remote] warning event')
    logStore.record('error', '[ds-harness-remote] error event')

    const settings = settingsBinding({ logLevel: 'info' })
    const control = new PluginControlRuntime(
      resolveConfig(settings.get()),
      directory,
      settings,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      logStore,
    )
    control.setStartupFailure(new Error('storage locked'))
    const handler = register(control)

    const all = await handler('settings.logs.get', {}, signal())
    expect(all).toMatchObject({
      ok: true,
      value: {
        logLevel: 'info',
        totalBuffered: 3,
        filePath: logFile,
      },
    })
    expect((all as any).value.entries).toHaveLength(3)

    const warnOnly = await handler('settings.logs.get', { filter: 'warn', limit: 1 }, signal())
    expect(warnOnly).toMatchObject({ ok: true })
    expect((warnOnly as any).value.entries).toHaveLength(1)
    expect((warnOnly as any).value.entries[0].line).toContain('error event')

    expect(await handler('settings.logs.get', { filter: 'debug' }, signal())).toMatchObject({ ok: false })
    expect(await handler('settings.logs.get', { limit: 0 }, signal())).toMatchObject({ ok: false })

    const cleared = await handler('settings.logs.clear', {}, signal())
    expect(cleared).toMatchObject({
      ok: true,
      value: {
        logLevel: 'info',
        entries: [],
        totalBuffered: 0,
      },
    })
  })

  it('clears Host authorization before Client on logout so pairingHostOnly lifts in sequence', async () => {
    const directory = await temporaryDirectory()
    const settings = settingsBinding({ serverUrl: 'https://dsh.r2049.cn' })
    const order: string[] = []
    let pairingHostOnly = true
    const host = {
      hostStatus: () => ({ configured: true, online: false, reconnecting: false, authorized: !pairingHostOnly, accountRequired: false, pairingHostOnly }),
      reconnectHost: vi.fn(),
      clearHostAuthorization: vi.fn(async () => { order.push('host'); pairingHostOnly = false }),
      authorizeHostAsOwned: vi.fn(),
      authorizeHostWithAccount: vi.fn(),
      authorizeHostWithCode: vi.fn(),
    } as unknown as HostAuthorizationControl
    const client = {
      handleControl: vi.fn(async () => ({ ok: true as const, value: {} })),
      clearClientAuthorization: vi.fn(async () => { order.push(pairingHostOnly ? 'client-still-host-only' : 'client-unblocked') }),
    } as unknown as ClientModeRuntime
    const handler = register(new PluginControlRuntime(resolveConfig(settings.get()), directory, settings, client, host))
    await expect(handler('settings.logout', {}, signal())).resolves.toMatchObject({ ok: true })
    expect(order).toEqual(['host', 'client-unblocked'])
  })

  it('closes active Host and Client runtimes before resetting identities on disk', async () => {
    const root = await temporaryDirectory()
    const settings = settingsBinding({ serverUrl: 'https://dsh.r2049.cn' })
    const events: string[] = []
    const host = {
      hostStatus: () => ({ configured: true, online: true, reconnecting: false, authorized: true, accountRequired: false }),
      reconnectHost: vi.fn(),
      clearHostAuthorization: vi.fn(),
      authorizeHostAsOwned: vi.fn(),
      authorizeHostWithAccount: vi.fn(),
      authorizeHostWithCode: vi.fn(),
      close: vi.fn(async () => { events.push('host-close') }),
    } as unknown as HostAuthorizationControl
    const client = {
      handleControl: vi.fn(async (endpoint: string) => { events.push('client-' + endpoint); return { ok: true as const, value: {} } }),
      clearClientAuthorization: vi.fn(),
      close: vi.fn(async () => { events.push('client-close') }),
    } as unknown as ClientModeRuntime
    const switchServer = vi.fn(async () => { events.push('switchServer'); return { client, host } })
    const handler = register(new PluginControlRuntime(resolveConfig(settings.get()), root, settings, client, host, switchServer))
    await expect(handler('settings.identity.reset', { role: 'host' }, signal())).resolves.toMatchObject({ ok: true })
    expect(events).toEqual(['client-mode.set', 'client-close', 'host-close', 'switchServer'])
  })
})
function register(runtime: PluginControlRuntime) {
  let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ControlResult<unknown>>) | undefined
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

function settingsBinding(initial: Config): PluginSettingsBinding {
  let value = structuredClone(initial)
  return {
    get: () => structuredClone(value),
    replace: async section => { value = structuredClone(section) },
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
