import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPair } from '@dsh-remote/crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostIdentity } from '../src/identity-store.js'
import { ClientServerApi, HostServerApi } from '../src/server-api.js'
import { ServerCredentialStore } from '../src/server-credentials.js'

const directories: string[] = []

const cleanupContract1 = async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
}
afterEach(cleanupContract1)

describe('HostServerApi', () => {
  it('cancels runtime-owned HTTP work through response consumption and rejects requests after close', async () => {
    await runScenarios([
      { name: 'close before response headers', body: false, timeout: false },
      { name: 'close during response body', body: true, timeout: false },
      { name: 'deadline during response body', body: true, timeout: true },
    ].map(scenario => ({ name: scenario.name, run: async () => {
      const directory = await mkdtemp(join(tmpdir(), 'dsh-server-close-'))
      directories.push(directory)
      let started!: () => void
      const ready = new Promise<void>(resolve => { started = resolve })
      let requestSignal: AbortSignal | null | undefined
      const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
        requestSignal = init?.signal
        if (!scenario.body) return new Promise<Response>((_resolve, reject) => {
          requestSignal!.addEventListener('abort', () => reject(requestSignal!.reason), { once: true })
          started()
        })
        return new Response(new ReadableStream({ start(controller) {
          requestSignal!.addEventListener('abort', () => controller.error(requestSignal!.reason), { once: true })
          started()
        } }))
      })
      const api = new HostServerApi('https://example.invalid', new ServerCredentialStore(directory), fetchMock)
      if (scenario.timeout) vi.useFakeTimers()
      try {
        const rejected = expect(api.oauthProviders()).rejects.toMatchObject({
          code: scenario.timeout ? 'CONNECTION_FAILED' : 'CONNECTION_CLOSED',
          retryable: scenario.timeout,
        })
        await ready
        if (scenario.timeout) await vi.advanceTimersByTimeAsync(10_000)
        else api.close()
        await rejected
        expect(requestSignal?.aborted).toBe(true)
        api.close()
        await expect(api.oauthProviders()).rejects.toMatchObject({ code: 'CONNECTION_CLOSED', retryable: false })
        expect(fetchMock).toHaveBeenCalledTimes(1)
      } finally {
        api.close()
        vi.useRealTimers()
      }
    } })))
  })
  it('discovers future providers and uses their advertised QR entry without account credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-oauth-discovery-'))
    directories.push(directory)
    const provider = { ...oauthProvider('future-provider'), displayName: 'Future Provider',
      qrStartUrl: '/api/v1/auth/oauth/future/qr/start?mode=desktop' }
    const fetchMock = vi.fn(async (input, init) => {
      expect(init?.headers).not.toHaveProperty('Authorization')
      if (String(input).endsWith('/oauth/providers')) return json({ items: [provider], futureField: true })
      expect(String(input)).toBe(`https://dsh.r2049.cn${provider.qrStartUrl}`)
      expect(init?.method).toBe('POST')
      return json({ qrId: 'future-qr-session-1234567890', scanUrl: 'https://dsh.r2049.cn/api/v1/auth/q/future', expiresIn: 600, provider: provider.id })
    }) as unknown as typeof fetch
    const api = new HostServerApi('https://dsh.r2049.cn', new ServerCredentialStore(directory), fetchMock)
    expect(await api.oauthProviders()).toEqual([provider])
    await expect(api.startOAuthQrLogin(provider.id)).resolves.toMatchObject({ expiresIn: 600 })
    await expect(api.startOAuthQrLogin('unlisted')).rejects.toMatchObject({ code: 'OAUTH_PROVIDER_UNAVAILABLE' })
  })

  it('rejects unsafe discovery and mismatched future-provider QR sessions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-oauth-discovery-invalid-'))
    directories.push(directory)
    const valid = oauthProvider('future-provider')
    await runScenarios([
      { name: 'external entry', provider: { ...valid, qrStartUrl: 'https://evil.example/start' } },
      { name: 'protocol-relative entry', provider: { ...valid, startUrl: '//evil.example/start' } },
      { name: 'traversal entry', provider: { ...valid, qrStartUrl: '/api/v1/auth/../devices' } },
      { name: 'encoded traversal', provider: { ...valid, qrStartUrl: '/api/v1/auth/%2e%2e/devices' } },
      { name: 'control character in name', provider: { ...valid, displayName: 'Future\u001b[31m' } },
      { name: 'invalid ID', provider: { ...valid, id: 'future&provider=github' } },
      { name: 'mismatched QR provider', provider: valid },
    ].map(scenario => ({ name: scenario.name, run: async () => {
      const fetchMock = vi.fn(async input => String(input).endsWith('/oauth/providers')
        ? json({ items: [scenario.provider] })
        : json({ qrId: 'future-qr-session-1234567890', scanUrl: 'https://dsh.r2049.cn/api/v1/auth/q/future', expiresIn: 600, provider: 'github' })) as unknown as typeof fetch
      const api = new HostServerApi('https://dsh.r2049.cn', new ServerCredentialStore(directory), fetchMock)
      await expect(api.startOAuthQrLogin('future-provider')).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
    } })))
  })

  it('falls back to configured legacy providers only when discovery is absent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-oauth-legacy-'))
    directories.push(directory)
    const fetchMock = vi.fn(async input => {
      const path = String(input)
      if (path.endsWith('/oauth/providers')) return json({}, 404)
      if (path.endsWith('/oauth/github/status')) return json({ configured: true })
      if (path.endsWith('/oauth/status')) return json({ configured: false })
      throw new Error(`Unexpected request: ${path}`)
    }) as unknown as typeof fetch
    const api = new HostServerApi('https://dsh.r2049.cn', new ServerCredentialStore(directory), fetchMock)
    expect(await api.oauthProviders()).toEqual([oauthProvider('github')])
  })

  it('starts a GitHub QR login through the provider-aware Server endpoint', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-server-github-qr-'))
    directories.push(directory)
    const fetchMock = vi.fn(async input => String(input).endsWith('/oauth/providers') ? json({ items: [oauthProvider('github')] }) : json({
      qrId: 'github-qr-session-1234567890',
      scanUrl: 'HTTPS://DSH.R2049.CN:443/api/v1/auth/q/github-qr-session-1234567890',
      expiresIn: 600,
      provider: 'github',
    })) as unknown as typeof fetch
    const api = new HostServerApi(
      'https://dsh.r2049.cn',
      new ServerCredentialStore(directory),
      fetchMock,
    )

    await expect(api.startOAuthQrLogin('github')).resolves.toMatchObject({
      qrId: 'github-qr-session-1234567890',
      scanUrl: 'https://dsh.r2049.cn/api/v1/auth/q/github-qr-session-1234567890',
      expiresIn: 600,
    })
    expect(String(vi.mocked(fetchMock).mock.calls[1]?.[0])).toBe(
      'https://dsh.r2049.cn/api/v1/auth/oauth/qr/start?provider=github',
    )
  })

  it('rejects QR login URLs containing terminal control characters', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-server-unsafe-qr-'))
    directories.push(directory)
    const fetchMock = vi.fn(async input => String(input).endsWith('/oauth/providers') ? json({ items: [oauthProvider('github')] }) : json({
      qrId: 'github-qr-session-1234567890',
      scanUrl: 'https://dsh.r2049.cn/api/v1/auth/q/qr\u001b]8;;https://evil.example\u0007',
      expiresIn: 600,
      provider: 'github',
    })) as unknown as typeof fetch
    const api = new HostServerApi(
      'https://dsh.r2049.cn',
      new ServerCredentialStore(directory),
      fetchMock,
    )

    await expect(api.startOAuthQrLogin('github')).rejects.toMatchObject({
      code: 'INVALID_MESSAGE',
      retryable: false,
    })
  })

  it('retries a completed QR login with a recovered device identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-server-qr-revoked-'))
    directories.push(directory)
    const qrId = 'qr-complete-session-1234567890'
    const identity = hostIdentity()
    const recoveredIdentity: HostIdentity = {
      ...identity,
      deviceId: '0198a2d0-0000-7000-8000-000000000002',
      fingerprint: '1111 1111 1111',
      ...generateKeyPair(new Uint8Array(32).fill(8)),
    }
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let registerCalls = 0
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith(`/auth/oauth/qr/${qrId}`)) return json({
        status: 'complete',
        token: 'web-account-token-value',
      })
      if (url.endsWith('/auth/me')) return json({
        account: 'client@example.com',
        isAdmin: false,
      })
      if (url.endsWith('/devices/register')) {
        registerCalls += 1
        if (registerCalls === 1) return errorJson('DEVICE_REVOKED', 'device was revoked', 403)
        return json(tokens({ accessToken: 'client-access-token-value', refreshToken: 'client-refresh-token-value' }))
      }
      throw new Error(`unexpected request: ${url}`)
    }) as unknown as typeof fetch
    const store = new ServerCredentialStore(directory)
    const api = new ClientServerApi('https://dsh.r2049.cn', store, fetchMock)
    const recoverIdentity = vi.fn(async () => recoveredIdentity)

    await expect(api.pollOAuthQrLogin(identity, qrId, recoverIdentity)).resolves.toEqual({
      status: 'complete',
      authorization: { method: 'account', account: 'client@example.com', isAdmin: false },
    })

    expect(recoverIdentity).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(calls[2]?.init?.body))).toMatchObject({
      device: { deviceId: identity.deviceId, role: 'client', identityKey: identity.publicKey },
    })
    expect(JSON.parse(String(calls[3]?.init?.body))).toMatchObject({
      device: { deviceId: recoveredIdentity.deviceId, role: 'client', identityKey: recoveredIdentity.publicKey },
    })
    expect(calls[2]?.init?.headers).toMatchObject({ Authorization: 'Bearer web-account-token-value' })
    expect(calls[3]?.init?.headers).toMatchObject({ Authorization: 'Bearer web-account-token-value' })
    await expect(store.load('https://dsh.r2049.cn', recoveredIdentity.deviceId)).resolves.toMatchObject({
      authorizationMethod: 'account',
      account: 'client@example.com',
      accessToken: 'client-access-token-value',
    })
  })

  it('retries account login with a recovered Host identity after device removal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-server-account-revoked-'))
    directories.push(directory)
    const identity = hostIdentity()
    const recoveredIdentity: HostIdentity = {
      ...identity,
      deviceId: '0198a2d0-0000-7000-8000-000000000003',
      fingerprint: '2222 2222 2222',
      ...generateKeyPair(new Uint8Array(32).fill(7)),
    }
    let registerCalls = 0
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/auth/login')) return json({
        token: 'web-account-token-value',
        expiresAt: Date.now() + 600_000,
        account: 'host@example.com',
        profile: {},
        isAdmin: false,
      })
      if (url.endsWith('/devices/register')) {
        registerCalls += 1
        return registerCalls === 1
          ? errorJson('DEVICE_REVOKED', 'device was revoked', 403)
          : json(tokens({ accessToken: 'recovered-access-token-value' }))
      }
      throw new Error(`unexpected request: ${url}`)
    }) as unknown as typeof fetch
    const api = new HostServerApi('https://dsh.r2049.cn', new ServerCredentialStore(directory), fetchMock)
    const recoverIdentity = vi.fn(async () => recoveredIdentity)

    await expect(api.authorizeWithAccount(identity, 'host@example.com', 'correct horse battery staple', recoverIdentity))
      .resolves.toMatchObject({ method: 'account', account: 'host@example.com' })
    expect(recoverIdentity).toHaveBeenCalledOnce()
    expect(JSON.parse(String(vi.mocked(fetchMock).mock.calls[1]?.[1]?.body))).toMatchObject({
      device: { deviceId: identity.deviceId },
    })
    expect(JSON.parse(String(vi.mocked(fetchMock).mock.calls[2]?.[1]?.body))).toMatchObject({
      device: { deviceId: recoveredIdentity.deviceId },
    })
    await expect(new ServerCredentialStore(directory).load('https://dsh.r2049.cn', recoveredIdentity.deviceId))
      .resolves.toMatchObject({ accessToken: 'recovered-access-token-value' })
  })

  it('authorizes Host enrollment through account, code or owned-role credentials', async () => {
    await runScenarios(
      [
        {
          name: 'logs in, authorizes Host registration, persists device credentials, and authenticates peer lookup',
          run: async () => {
            const directory = await mkdtemp(join(tmpdir(), 'dsh-server-api-'))
            directories.push(directory)
            const calls: Array<{ url: string; init?: RequestInit }> = []
            const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
              const url = String(input)
              calls.push({ url, init })
              if (url.endsWith('/auth/login'))
                return json({
                  token: 'web-account-token-value',
                  expiresAt: Date.now() + 600_000,
                  account: 'host@example.com',
                  profile: {},
                  isAdmin: false,
                })
              if (url.endsWith('/devices/register')) return json(tokens())
              if (url.endsWith('/devices/client-1'))
                return json({
                  deviceId: 'client-1',
                  name: 'Browser',
                  role: 'client',
                  platform: 'web',
                  identityKey: generateKeyPair(new Uint8Array(32).fill(4)).publicKey,
                  membershipId: 'membership-1',
                })
              throw new Error(`unexpected request: ${url}`)
            }) as unknown as typeof fetch
            const store = new ServerCredentialStore(directory)
            const api = new HostServerApi('https://dsh.r2049.cn/', store, fetchMock)
            api.setHarnessVersion('0.1.0-rc.8')
            const identity = hostIdentity()

            await api.authorizeWithAccount(identity, 'host@example.com', 'correct horse battery staple')
            await api.deviceFor('client-1')

            expect(calls[0]?.url).toBe('https://dsh.r2049.cn/api/v1/auth/login')
            expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
              email: 'host@example.com',
              password: 'correct horse battery staple',
            })
            expect(calls[1]?.url).toBe('https://dsh.r2049.cn/api/v1/devices/register')
            expect(calls[1]?.init?.headers).toMatchObject({ Authorization: 'Bearer web-account-token-value' })
            const registeredDevice = JSON.parse(String(calls[1]?.init?.body))
            expect(registeredDevice).toMatchObject({
              v: 1,
              device: { deviceId: identity.deviceId, role: 'host', identityKey: identity.publicKey },
            })
            expect(registeredDevice.device).toHaveProperty('harnessVersion', '0.1.0-rc.8')
            expect(calls[2]?.init?.headers).toMatchObject({ Authorization: 'Bearer access-token-value' })
            const stored = await readFile(join(directory, 'server-credentials.json'), 'utf8')
            expect(stored).toContain('host@example.com')
            expect(stored).not.toContain('correct horse battery staple')
            expect(stored).not.toContain('web-account-token-value')
            if (process.platform !== 'win32') {
              expect((await stat(join(directory, 'server-credentials.json'))).mode & 0o777).toBe(0o600)
            }

            const reloaded = new HostServerApi('https://dsh.r2049.cn', store, fetchMock)
            await reloaded.authenticate(identity)
            expect(fetchMock).toHaveBeenCalledTimes(3)
            expect(reloaded.currentAuthorization()).toMatchObject({
              method: 'account',
              account: 'host@example.com',
            })
          },
        },
        {
          name: 'registers a Host with a one-time account enrollment code',
          run: async () => {
            const directory = await mkdtemp(join(tmpdir(), 'dsh-server-code-'))
            directories.push(directory)
            const fetchMock = vi.fn(async () => json(tokens())) as unknown as typeof fetch
            const store = new ServerCredentialStore(directory)
            const api = new HostServerApi('https://dsh.r2049.cn', store, fetchMock)
            api.setHarnessVersion('0.1.0-rc.8')
            const identity = hostIdentity()

            await expect(api.authorizeHostWithCode(identity, 'abcd-efgh')).resolves.toEqual({
              method: 'host_registration_code',
            })

            expect(String(vi.mocked(fetchMock).mock.calls[0]?.[0])).toBe(
              'https://dsh.r2049.cn/api/v1/devices/register-with-code',
            )
            expect(JSON.parse(String(vi.mocked(fetchMock).mock.calls[0]?.[1]?.body))).toMatchObject({
              code: 'ABCD-EFGH',
              device: {
                deviceId: identity.deviceId,
                role: 'host',
                identityKey: identity.publicKey,
                harnessVersion: '0.1.0-rc.8',
              },
            })
            await expect(store.load('https://dsh.r2049.cn', identity.deviceId)).resolves.toMatchObject({
              authorizationMethod: 'host_registration_code',
            })
          },
        },
        {
          name: 'authorizes the opposite role from an already owned device credential',
          run: async () => {
            const directory = await mkdtemp(join(tmpdir(), 'dsh-server-owned-role-'))
            directories.push(directory)
            const fetchMock = vi.fn(async () => json(tokens())) as unknown as typeof fetch
            const store = new ServerCredentialStore(directory)
            const api = new ClientServerApi('https://dsh.r2049.cn', store, fetchMock)
            api.setHarnessVersion('0.1.0-rc.8')
            const identity = hostIdentity()

            await expect(
              api.authorizeOwnedRole(identity, 'authorizing-device-token', 'owner@example.com'),
            ).resolves.toEqual({
              method: 'owned_device',
              account: 'owner@example.com',
            })

            expect(String(vi.mocked(fetchMock).mock.calls[0]?.[0])).toBe(
              'https://dsh.r2049.cn/api/v1/devices/register-owned-role',
            )
            expect(vi.mocked(fetchMock).mock.calls[0]?.[1]?.headers).toMatchObject({
              Authorization: 'Bearer authorizing-device-token',
            })
            const registeredDevice = JSON.parse(String(vi.mocked(fetchMock).mock.calls[0]?.[1]?.body))
            expect(registeredDevice).toMatchObject({
              device: { deviceId: identity.deviceId, role: 'client' },
            })
            expect(registeredDevice.device).not.toHaveProperty('harnessVersion')
            await expect(store.load('https://dsh.r2049.cn', identity.deviceId)).resolves.toMatchObject({
              authorizationMethod: 'owned_device',
              account: 'owner@example.com',
            })
          },
        },
      ],
      async () => {
        await cleanupContract1()
      },
    )
  }, 15000)

  it('revokes the current Server device before clearing local credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-server-sign-out-'))
    directories.push(directory)
    const identity = hostIdentity()
    const store = new ServerCredentialStore(directory)
    await store.save({
      serverUrl: 'https://dsh.r2049.cn',
      deviceId: identity.deviceId,
      authorizationMethod: 'account',
      account: 'owner@example.com',
      ...tokens(),
    })
    const fetchMock = vi.fn(async () => json({ deviceId: identity.deviceId })) as unknown as typeof fetch
    const api = new HostServerApi('https://dsh.r2049.cn', store, fetchMock)
    api.bindIdentity(identity)

    await api.revokeCurrentDevice()

    expect(String(vi.mocked(fetchMock).mock.calls[0]?.[0])).toBe('https://dsh.r2049.cn/api/v1/devices/self')
    expect(vi.mocked(fetchMock).mock.calls[0]?.[1]).toMatchObject({
      method: 'DELETE',
      headers: { Authorization: 'Bearer access-token-value' },
    })
    await expect(store.load('https://dsh.r2049.cn', identity.deviceId)).resolves.toBeUndefined()
  })

  it('reports account authorization when a fresh Host cannot register anonymously', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-server-account-required-'))
    directories.push(directory)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'ACCOUNT_AUTH_REQUIRED', message: 'host registration requires account login', retryable: false },
    }), { status: 401, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    const api = new HostServerApi('https://dsh.r2049.cn', new ServerCredentialStore(directory), fetchMock)

    await expect(api.authenticate(hostIdentity())).rejects.toMatchObject({ code: 'ACCOUNT_AUTH_REQUIRED', retryable: false })
  })

  it('refreshes a server-rejected access token once for a read before requiring a login', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-client-read-refresh-'))
    directories.push(directory)
    const identity = hostIdentity()
    const store = new ServerCredentialStore(directory)
    const url = 'https://example.invalid'
    await store.save({ serverUrl: url, deviceId: identity.deviceId, authorizationMethod: 'account', ...tokens() })
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(errorJson('AUTH_INVALID', 'invalid access token', 401))
      .mockResolvedValueOnce(json(tokens({ accessToken: 'replacement-access-token', refreshToken: 'replacement-refresh-token' })))
      .mockResolvedValueOnce(json({ items: [] }))
    const api = new ClientServerApi(url, store, fetchMock)
    api.bindIdentity(identity)
    await expect(api.listDevices()).resolves.toEqual([])
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/api/v1/devices', '/api/v1/auth/refresh', '/api/v1/devices',
    ])
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get('Authorization')).toBe('Bearer replacement-access-token')
    fetchMock.mockClear()
      .mockResolvedValueOnce(errorJson('TOKEN_EXPIRED', 'expired access token', 401))
      .mockResolvedValueOnce(json(tokens()))
      .mockResolvedValueOnce(errorJson('AUTH_INVALID', 'still invalid', 401))
    await expect(api.listDevices()).rejects.toMatchObject({ code: 'AUTH_INVALID' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    fetchMock.mockClear().mockResolvedValueOnce(errorJson('AUTH_INVALID', 'rejected', 401))
    await expect(api.revokeCurrentDevice()).rejects.toMatchObject({ code: 'AUTH_INVALID' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('preserves authorization for temporary and unclassified device-list failures', async () => {
    await runScenarios([
      { name: 'Server outage with misleading auth code', response: errorJson('AUTH_INVALID', 'unavailable', 503), code: 'CONNECTION_FAILED' },
      { name: 'network failure', response: new Error('offline'), code: 'CONNECTION_FAILED' },
      { name: 'refresh outage', response: errorJson('AUTH_INVALID', 'unavailable', 503), code: 'CONNECTION_FAILED', expiredAccess: true },
      { name: 'unclassified unauthorized response', response: json({}, 401), code: 'CONNECTION_FAILED', retryable: true },
      { name: 'unclassified forbidden response', response: json({}, 403), code: 'CONNECTION_FAILED', retryable: true },
      { name: 'auth code on unrelated status', response: errorJson('DEVICE_REVOKED', 'unexpected', 400), code: 'INVALID_MESSAGE' },
      { name: 'explicit credential rejection', response: errorJson('AUTH_INVALID', 'expired', 401), code: 'AUTH_INVALID' },
    ].map(scenario => ({ name: scenario.name, run: async () => {
      const directory = await mkdtemp(join(tmpdir(), 'dsh-server-auth-errors-'))
      directories.push(directory)
      const identity = hostIdentity()
      const store = new ServerCredentialStore(directory)
      await store.save({
        serverUrl: 'https://dsh.r2049.cn',
        deviceId: identity.deviceId,
        authorizationMethod: 'account',
        ...tokens(scenario.expiredAccess ? { accessTokenExpiresAt: Date.now() - 1 } : {}),
      })
      const api = new ClientServerApi('https://dsh.r2049.cn', store, vi.fn(async () => {
        if (scenario.response instanceof Error) throw scenario.response
        return scenario.response.clone()
      }) as unknown as typeof fetch)
      api.bindIdentity(identity)
      await expect(api.listDevices()).rejects.toMatchObject({
        code: scenario.code, ...('retryable' in scenario ? { retryable: scenario.retryable } : {}),
      })
      await expect(store.load('https://dsh.r2049.cn', identity.deviceId)).resolves.toMatchObject({
        accessToken: 'access-token-value',
        refreshToken: 'refresh-token-value',
      })
    } })))
  })

  it('single-flights credential rotation and releases failed refresh locks', async () => {
    await runScenarios(
      [
        {
          name: 'rotates an expiring access token through the refresh endpoint',
          run: async () => {
            const directory = await mkdtemp(join(tmpdir(), 'dsh-server-refresh-'))
            directories.push(directory)
            const identity = hostIdentity()
            const store = new ServerCredentialStore(directory)
            await store.save({
              serverUrl: 'https://dsh.r2049.cn',
              deviceId: identity.deviceId,
              authorizationMethod: 'account',
              account: 'host@example.com',
              ...tokens({ accessTokenExpiresAt: Date.now() + 1_000 }),
            })
            const fetchMock = vi.fn(async () =>
              json(tokens({ accessToken: 'rotated-access-value', refreshToken: 'rotated-refresh-value' })),
            ) as unknown as typeof fetch
            const api = new HostServerApi('https://dsh.r2049.cn', store, fetchMock)

            await expect(api.authenticate(identity)).resolves.toMatchObject({
              accessToken: 'rotated-access-value',
            })
            await expect(store.load('https://dsh.r2049.cn', identity.deviceId)).resolves.toMatchObject({
              account: 'host@example.com',
            })
            expect(JSON.parse(String(vi.mocked(fetchMock).mock.calls[0]?.[1]?.body))).toMatchObject({
              deviceId: identity.deviceId,
              refreshToken: 'refresh-token-value',
            })
          },
        },
        {
          name: 'serializes expired-token refresh across independent API/store instances',
          run: async () => {
            const directory = await mkdtemp(join(tmpdir(), 'dsh-shared-refresh-'))
            directories.push(directory)
            const identity = hostIdentity()
            const store = new ServerCredentialStore(directory)
            await store.save({
              serverUrl: 'https://dsh.r2049.cn',
              deviceId: identity.deviceId,
              authorizationMethod: 'owned_device',
              ...tokens({ accessTokenExpiresAt: Date.now() - 1 }),
            })
            const fetchMock = vi.fn(async () => {
              await new Promise((resolve) => setTimeout(resolve, 75))
              return json(
                tokens({ accessToken: 'rotated-access-value', refreshToken: 'rotated-refresh-value' }),
              )
            }) as unknown as typeof fetch
            const first = new HostServerApi('https://dsh.r2049.cn', store, fetchMock)
            const second = new HostServerApi(
              'https://dsh.r2049.cn',
              new ServerCredentialStore(directory),
              fetchMock,
            )
            const results = await Promise.all([first.authenticate(identity), second.authenticate(identity)])
            expect(fetchMock).toHaveBeenCalledTimes(1)
            expect(results.map((result) => result.accessToken)).toEqual([
              'rotated-access-value',
              'rotated-access-value',
            ])
            expect(results[1]?.authorizationMethod).toBe('owned_device')
          },
        },
        {
          name: 'shares a rotation between explicit handshake recovery and authenticate',
          run: async () => {
            const directory = await mkdtemp(join(tmpdir(), 'dsh-shared-recovery-'))
            directories.push(directory)
            const identity = hostIdentity()
            const store = new ServerCredentialStore(directory)
            await store.save({
              serverUrl: 'https://dsh.r2049.cn',
              deviceId: identity.deviceId,
              authorizationMethod: 'account',
              ...tokens({ accessTokenExpiresAt: Date.now() - 1 }),
            })
            const fetchMock = vi.fn(async () => {
              await new Promise((resolve) => setTimeout(resolve, 75))
              return json(
                tokens({ accessToken: 'rotated-access-value', refreshToken: 'rotated-refresh-value' }),
              )
            }) as unknown as typeof fetch
            const api = new HostServerApi('https://dsh.r2049.cn', store, fetchMock)
            api.bindIdentity(identity)
            const results = await Promise.all([
              api.refreshCredentials('access-token-value'),
              api.authenticate(identity),
              api.refreshCredentials('access-token-value'),
            ])
            expect(fetchMock).toHaveBeenCalledTimes(1)
            expect(results.every((result) => result.accessToken === 'rotated-access-value')).toBe(true)
          },
        },
        {
          name: 'preserves refresh rejection and releases the lock without retrying the token',
          run: async () => {
            const directory = await mkdtemp(join(tmpdir(), 'dsh-rejected-refresh-'))
            directories.push(directory)
            const identity = hostIdentity()
            const store = new ServerCredentialStore(directory)
            await store.save({
              serverUrl: 'https://dsh.r2049.cn',
              deviceId: identity.deviceId,
              authorizationMethod: 'account',
              ...tokens({ accessTokenExpiresAt: Date.now() - 1 }),
            })
            const fetchMock = vi.fn(async () =>
              errorJson('AUTH_INVALID', 'refresh token reuse detected', 401),
            ) as unknown as typeof fetch
            const api = new HostServerApi('https://dsh.r2049.cn', store, fetchMock)
            await expect(api.authenticate(identity)).rejects.toMatchObject({
              code: 'AUTH_INVALID',
              phase: 'credential_refresh',
              retryable: false,
            })
            expect(fetchMock).toHaveBeenCalledTimes(1)
            await expect(stat(join(directory, 'server-credentials.json.refresh-lock'))).rejects.toMatchObject({
              code: 'ENOENT',
            })
          },
        },
      ],
      async () => {
        await cleanupContract1()
      },
    )
  }, 20000)

  it('registers the local remote-mode identity as a client device', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-server-client-'))
    directories.push(directory)
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/auth/login')) return json({
        token: 'web-account-token-value',
        expiresAt: Date.now() + 600_000,
        account: 'client@example.com',
        profile: {},
        isAdmin: false,
      })
      return json(tokens())
    }) as unknown as typeof fetch
    const identity = hostIdentity()
    const api = new ClientServerApi('https://dsh.r2049.cn', new ServerCredentialStore(directory), fetchMock)

    await api.authorizeWithAccount(identity, 'client@example.com', 'correct horse battery staple')

    expect(JSON.parse(String(vi.mocked(fetchMock).mock.calls[1]?.[1]?.body))).toMatchObject({
      device: { deviceId: identity.deviceId, role: 'client' },
    })
    expect(vi.mocked(fetchMock).mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer web-account-token-value' })
  })
})

function oauthProvider(id: string) {
  return { id, displayName: id === 'github' ? 'GitHub' : id,
    startUrl: `/api/v1/auth/oauth/${id}/start`, qrStartUrl: `/api/v1/auth/oauth/qr/start?provider=${id}` }
}

function hostIdentity(): HostIdentity {
  const keys = generateKeyPair(new Uint8Array(32).fill(9))
  return {
    schemaVersion: 1,
    deviceId: '0198a2d0-0000-7000-8000-000000000001',
    name: 'Test Host',
    fingerprint: '0000 0000 0000',
    ...keys,
  }
}

interface TestTokens {
  accessToken: string
  accessTokenExpiresAt: number
  refreshToken: string
  refreshTokenExpiresAt: number
}

function tokens(overrides: Partial<TestTokens> = {}): TestTokens {
  return {
    accessToken: 'access-token-value',
    accessTokenExpiresAt: Date.now() + 600_000,
    refreshToken: 'refresh-token-value',
    refreshTokenExpiresAt: Date.now() + 86_400_000,
    ...overrides,
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function errorJson(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({
    error: { code, message, retryable: false },
  }), { status, headers: { 'content-type': 'application/json' } })
}

it('preserves credentials through gateway failures and recovers on the next attempt', async () => {
  await runScenarios([502, 503, 504, 429].map(status => ({
    name: `HTML gateway response ${status}`,
    run: async () => {
      const directory = await mkdtemp(join(tmpdir(), 'dsh-gateway-refresh-'))
      directories.push(directory)
      const identity = hostIdentity()
      const store = new ServerCredentialStore(directory)
      const initial = await store.save({ serverUrl: 'https://dsh.r2049.cn', deviceId: identity.deviceId,
        authorizationMethod: 'account', ...tokens({ accessTokenExpiresAt: Date.now() - 1 }) })
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response('<html>gateway unavailable</html>', { status }))
        .mockResolvedValueOnce(json(tokens({ refreshToken: 'recovered-refresh-value' })))
      const api = new HostServerApi('https://dsh.r2049.cn', store, fetchMock)
      await expect(api.authenticate(identity)).rejects.toMatchObject({
        code: status === 429 ? 'RATE_LIMITED' : 'CONNECTION_FAILED', status,
        retryable: true, phase: 'credential_refresh', reason: 'invalid_json',
      })
      expect(await store.load('https://dsh.r2049.cn', identity.deviceId)).toEqual(initial)
      expect((await api.authenticate(identity)).refreshToken).toBe('recovered-refresh-value')
      const bodies = fetchMock.mock.calls.map(call => JSON.parse(call[1].body as string))
      expect(bodies.every(body => body.refreshToken === initial.refreshToken)).toBe(true)
    },
  })), cleanupContract1)
})

it('does not treat a 503 authorization-shaped envelope as permanent authorization failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-busy-refresh-'))
  directories.push(directory)
  const identity = hostIdentity()
  const store = new ServerCredentialStore(directory)
  await store.save({ serverUrl: 'https://dsh.r2049.cn', deviceId: identity.deviceId,
    authorizationMethod: 'account', ...tokens({ accessTokenExpiresAt: Date.now() - 1 }) })
  const api = new HostServerApi('https://dsh.r2049.cn', store,
    vi.fn(async () => errorJson('AUTH_INVALID', 'server internal failure', 503)) as unknown as typeof fetch)
  await expect(api.authenticate(identity)).rejects.toMatchObject({
    code: 'CONNECTION_FAILED', retryable: true, status: 503, phase: 'credential_refresh', reason: 'http_error',
  })
})

it('uses newly saved credentials after a delayed refresh rejection without retrying the rejected token', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-late-refresh-'))
  directories.push(directory)
  const identity = hostIdentity()
  const store = new ServerCredentialStore(directory)
  const initial = await store.save({ serverUrl: 'https://dsh.r2049.cn', deviceId: identity.deviceId,
    authorizationMethod: 'account', ...tokens({ accessTokenExpiresAt: Date.now() - 1 }) })
  const newer = { ...initial, ...tokens({ accessToken: 'newer-access-token-value', refreshToken: 'newer-refresh-token-value' }) }
  const fetchMock = vi.fn(async () => {
    await store.save(newer)
    return errorJson('AUTH_INVALID', 'obsolete refresh token', 401)
  })
  const api = new HostServerApi('https://dsh.r2049.cn', store, fetchMock as unknown as typeof fetch)
  expect((await api.authenticate(identity)).refreshToken).toBe(newer.refreshToken)
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('retries unstructured authorization responses but preserves explicit protocol rejections', async () => {
  const responses = [
    { name: 'rate limit with revoked code', status: 429, body: JSON.stringify({ error: { code: 'DEVICE_REVOKED', message: 'Retry later', retryable: false } }), limited: true },
    { name: 'HTML 401', status: 401, body: '<html>gateway challenge</html>', reason: 'invalid_json' },
    { name: 'empty 401', status: 401, body: '', reason: 'invalid_error_envelope' },
    { name: 'gateway JSON 401', status: 401, body: '{"detail":"gateway unavailable"}', reason: 'invalid_error_envelope' },
    { name: 'incomplete envelope', status: 401, body: '{"error":{"code":"AUTH_INVALID"}}', reason: 'invalid_error_envelope' },
    { name: 'null JSON', status: 401, body: 'null', reason: 'invalid_error_envelope' },
    { name: 'HTML 403', status: 403, body: '<html>gateway challenge</html>', reason: 'invalid_json' },
    { name: 'empty 403', status: 403, body: '', reason: 'invalid_error_envelope' },
    { name: 'protocol invalid token', status: 401, body: JSON.stringify({ error: { code: 'AUTH_INVALID', message: 'obsolete token', retryable: false } }), terminal: 'AUTH_INVALID' },
    { name: 'protocol revoked device', status: 403, body: JSON.stringify({ error: { code: 'DEVICE_REVOKED', message: 'revoked', retryable: false } }), terminal: 'DEVICE_REVOKED' },
  ]
  await runScenarios(responses.map(row => ({ name: row.name, run: async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-auth-envelope-'))
    directories.push(directory)
    const identity = hostIdentity()
    const store = new ServerCredentialStore(directory)
    const initial = await store.save({ serverUrl: 'https://dsh.r2049.cn', deviceId: identity.deviceId,
      authorizationMethod: 'account', ...tokens({ accessTokenExpiresAt: Date.now() - 1 }) })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(row.body, { status: row.status }))
      .mockResolvedValueOnce(json(tokens({ refreshToken: 'recovered-refresh-value' })))
    const api = new HostServerApi('https://dsh.r2049.cn', store, fetchMock)
    await expect(api.authenticate(identity)).rejects.toMatchObject({
      code: row.terminal ?? (row.limited ? 'RATE_LIMITED' : 'CONNECTION_FAILED'), retryable: row.terminal === undefined,
      status: row.status, phase: 'credential_refresh', reason: row.reason ?? 'http_error',
    })
    expect(await store.load('https://dsh.r2049.cn', identity.deviceId)).toEqual(initial)
    if (row.terminal === undefined) {
      expect((await api.authenticate(identity)).refreshToken).toBe('recovered-refresh-value')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } else expect(fetchMock).toHaveBeenCalledTimes(1)
  } })), cleanupContract1)
})
