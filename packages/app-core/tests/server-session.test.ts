import { describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { RemoteServerApi } from '../src/services/api'
import { AccountRequiredError, ServerSessionManager } from '../src/services/server-session-manager'
import type { DeviceCredentials, DeviceIdentity } from '../src/types'

const identity: DeviceIdentity = {
  deviceId: '0198abc0-1234-7abc-8123-123456789abc',
  name: 'Pixel',
  platform: 'android',
  publicKey: 'A'.repeat(43),
  privateKey: 'B'.repeat(43),
}

function storedCredentials(overrides: Partial<DeviceCredentials> = {}): DeviceCredentials {
  return {
    serverUrl: 'https://remote.example.com',
    deviceId: identity.deviceId,
    authorizationMethod: 'account',
    account: 'user@example.com',
    accessToken: 'expired-access-token',
    accessTokenExpiresAt: Date.now() - 1,
    refreshToken: 'current-refresh-token',
    refreshTokenExpiresAt: Date.now() + 120_000,
    ...overrides,
  }
}

describe('Server credential session', () => {
  it('single-flights refresh token rotation and atomically saves the replacement', async () => {
    const save = vi.fn(async (_credentials: DeviceCredentials) => {})
    const persistence = { load: vi.fn(async () => storedCredentials()), save }
    const fetchImplementation = vi.fn<typeof fetch>(async input => {
      expect(String(input)).toContain('/api/v1/auth/refresh')
      await Promise.resolve()
      return jsonResponse({
        accessToken: 'replacement-access-token',
        accessTokenExpiresAt: Date.now() + 60_000,
        refreshToken: 'replacement-refresh-token',
        refreshTokenExpiresAt: Date.now() + 120_000,
      })
    })
    const manager = new ServerSessionManager(
      persistence,
      (baseUrl, accessToken) => new RemoteServerApi(baseUrl, accessToken, fetchImplementation),
    )

    const [first, second] = await Promise.all([
      manager.authenticate('https://remote.example.com', identity),
      manager.authenticate('https://remote.example.com', identity),
    ])

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(first.credentials.accessToken).toBe('replacement-access-token')
    expect(second.credentials).toEqual(first.credentials)
  })

  it('requires a fresh account login when the refresh credential has expired', async () => {
    const expired = storedCredentials({ refreshTokenExpiresAt: Date.now() - 1 })
    const manager = new ServerSessionManager(
      { load: async () => expired, save: async () => {} },
      (baseUrl, accessToken) => new RemoteServerApi(baseUrl, accessToken),
    )
    await expect(manager.authenticate('https://remote.example.com', identity))
      .rejects.toBeInstanceOf(AccountRequiredError)
  })

  it('logs in with the account and registers the client device, storing only device tokens', async () => {
    const save = vi.fn(async (_credentials: DeviceCredentials) => {})
    const fetchImplementation = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/login')) {
        return jsonResponse({
          token: 'account-jwt-token-123456',
          expiresAt: Date.now() + 60_000,
          account: 'user@example.com',
          profile: {},
          isAdmin: false,
        })
      }
      expect(url).toContain('/api/v1/devices/register')
      return jsonResponse({
        accessToken: 'registered-access-token',
        accessTokenExpiresAt: Date.now() + 60_000,
        refreshToken: 'registered-refresh-token',
        refreshTokenExpiresAt: Date.now() + 120_000,
      })
    })
    const manager = new ServerSessionManager(
      { load: async () => undefined, save },
      (baseUrl, accessToken) => new RemoteServerApi(baseUrl, accessToken, fetchImplementation),
    )
    const result = await manager.authenticateWithAccount(
      'https://remote.example.com',
      identity,
      'user@example.com',
      'secret',
    )
    expect(result.credentials).toMatchObject({
      serverUrl: 'https://remote.example.com',
      deviceId: identity.deviceId,
      authorizationMethod: 'account',
      account: 'user@example.com',
      accessToken: 'registered-access-token',
    })
    expect(save).toHaveBeenCalledTimes(1)
    const saved = save.mock.calls[0]?.[0] as DeviceCredentials
    expect(saved.account).toBe('user@example.com')
    expect(saved).not.toHaveProperty('accountToken')
  })

  it('registers a new iOS identity only after the server explicitly rejects the old registration', async () => {
    const oldIdentity: DeviceIdentity = { ...identity, name: 'iPhone', platform: 'ios' }
    const nextIdentity: DeviceIdentity = {
      ...oldIdentity,
      deviceId: '0198abc0-1234-7abc-8123-123456789abd',
      publicKey: 'E'.repeat(43),
    }
    await runScenarios([
      { name: 'other account or legacy owner', status: 403, body: { error: { code: 'DEVICE_OWNERSHIP_REQUIRED' } }, recover: true },
      { name: 'revoked identity', status: 401, body: { error: { code: 'DEVICE_REVOKED' } }, recover: true },
      { name: 'uncoded conflict', status: 409, body: {}, recover: false, code: 'INVALID_MESSAGE' },
      { name: 'pairing required', status: 403, body: { error: { code: 'PAIRING_REQUIRED' } }, recover: false, code: 'PAIRING_REQUIRED' },
      { name: 'account token rejected', status: 401, body: { error: { code: 'AUTH_INVALID' } }, recover: false, code: 'AUTH_INVALID' },
      { name: 'retryable server error', status: 503, body: { error: { code: 'DEVICE_OWNERSHIP_REQUIRED' } }, recover: false, code: 'DEVICE_OWNERSHIP_REQUIRED' },
      { name: 'new registration rejected', status: 403, body: { error: { code: 'DEVICE_OWNERSHIP_REQUIRED' } }, recover: true, code: 'DEVICE_OWNERSHIP_REQUIRED' },
    ].map(scenario => ({ name: scenario.name, run: async () => {
      const baseUrl = 'https://remote.example.com'
      const account = 'user@example.com'
      const accountToken = 'account-jwt-token-123456'
      const posted: Array<{ deviceId: string; identityKey: string; platform: string }> = []
      const recoverIdentity = vi.fn(async () => nextIdentity)
      const save = vi.fn(async (_credentials: DeviceCredentials) => {})
      const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
        expect(input).toBe(`${baseUrl}/api/v1/devices/register`)
        expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${accountToken}`)
        posted.push(JSON.parse(init?.body as string).device)
        if (posted.length === 1 || scenario.code !== undefined) return jsonResponse(scenario.body, scenario.status)
        return jsonResponse({
          accessToken: 'registered-access-token', accessTokenExpiresAt: Date.now() + 60_000,
          refreshToken: 'registered-refresh-token', refreshTokenExpiresAt: Date.now() + 120_000,
        })
      })
      const manager = new ServerSessionManager(
        { load: async () => undefined, save },
        (url, accessToken) => new RemoteServerApi(url, accessToken, fetchImplementation),
      )
      const registration = manager.registerWithAccountToken(baseUrl, oldIdentity, accountToken, account, recoverIdentity)
      if (scenario.code === undefined) {
        await expect(registration).resolves.toMatchObject({ credentials: { deviceId: nextIdentity.deviceId, account } })
        expect(save).toHaveBeenCalledTimes(1)
        expect(save).toHaveBeenCalledWith(expect.objectContaining({ deviceId: nextIdentity.deviceId }))
      } else {
        await expect(registration).rejects.toMatchObject({ code: scenario.code })
        expect(save).not.toHaveBeenCalled()
      }
      const identities = scenario.recover ? [oldIdentity, nextIdentity] : [oldIdentity]
      expect(posted).toMatchObject(identities.map(device => ({
        deviceId: device.deviceId, identityKey: device.publicKey, platform: 'ios',
      })))
      expect(recoverIdentity).toHaveBeenCalledTimes(scenario.recover ? 1 : 0)
    } })))
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
