import { describe, expect, it, vi } from 'vitest'
import { ANDROID_CLIENT_VERSION, RemoteServerApi } from '../src/services/api'
import type { DeviceIdentity } from '../src/types'

const identity: DeviceIdentity = {
  deviceId: '0198abc0-1234-7abc-8123-123456789abc',
  name: 'Pixel · DSH Remote',
  platform: 'android',
  publicKey: 'A'.repeat(43),
  privateKey: 'B'.repeat(43),
}

describe('Remote Server API compatibility', () => {
  it('registers the Android descriptor with the account token and validates the token pair', async () => {
    const calls: Array<{ url: string; body?: unknown; headers?: unknown }> = []
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      calls.push({ url: String(input), body: init?.body, headers: init?.headers })
      return jsonResponse(tokenPair('registered'))
    })
    const tokens = await new RemoteServerApi('https://remote.example.com', undefined, fetchImplementation)
      .registerDevice(identity, 'account-token')
    expect(tokens.accessToken).toBe('access-registered-token')
    expect(calls[0]?.url).toBe('https://remote.example.com/api/v1/devices/register')
    expect(calls[0]?.headers).toMatchObject({ Authorization: 'Bearer account-token' })
    expect(JSON.parse(String(calls[0]?.body))).toMatchObject({
      v: 1,
      device: {
        deviceId: identity.deviceId,
        role: 'client',
        platform: 'android',
        identityKey: identity.publicKey,
        clientVersion: ANDROID_CLIENT_VERSION,
      },
    })
  })

  it('logs in with the account and returns the account session', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({ email: 'user@example.com', password: 'secret' })
      expect(init?.headers).not.toMatchObject({ Authorization: expect.anything() })
      return jsonResponse({
        token: 'account-jwt-token-123456',
        expiresAt: Date.now() + 60_000,
        account: 'user@example.com',
        profile: {},
        isAdmin: false,
      })
    })
    const api = new RemoteServerApi('https://remote.example.com', undefined, fetchImplementation)
    const login = await api.loginAccount('user@example.com', 'secret')
    expect(login).toMatchObject({ token: 'account-jwt-token-123456', account: 'user@example.com', isAdmin: false })
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe('https://remote.example.com/api/v1/auth/login')
  })

  it('uses Bearer auth and accepts Server device and presence shapes that omit identity keys', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url.endsWith('/presence')) {
        return jsonResponse({ deviceId: 'host-1', online: true, lastSeenAt: 1234 })
      }
      return jsonResponse({
        items: [{
          deviceId: 'host-1', name: 'Workstation', role: 'host', platform: 'linux',
          membershipId: 'membership-1', harnessVersion: '0.1.0', lastConnectedAt: null,
        }],
        nextCursor: null,
      })
    })
    const api = new RemoteServerApi('https://remote.example.com', 'access-token-for-client', fetchImplementation)
    expect(await api.listDevices()).toEqual([expect.objectContaining({
      deviceId: 'host-1', name: 'Workstation', role: 'host', platform: 'linux',
      membershipId: 'membership-1', harnessVersion: '0.1.0',
    })])
    expect(await api.getPresence('host-1')).toEqual({ deviceId: 'host-1', online: true, lastSeenAt: 1234 })
    expect(fetchImplementation.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer access-token-for-client' })
  })

  it('fetches the authorized peer descriptor with the identity key for pinning', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => jsonResponse({
      deviceId: 'host-1', name: 'Workstation', role: 'host', platform: 'linux',
      identityKey: 'C'.repeat(43), membershipId: 'membership-1',
    }))
    const api = new RemoteServerApi('https://remote.example.com', 'access-token-for-client', fetchImplementation)
    const peer = await api.deviceFor('host-1')
    expect(peer).toMatchObject({ deviceId: 'host-1', identityKey: 'C'.repeat(43), membershipId: 'membership-1' })
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe('https://remote.example.com/api/v1/devices/host-1')
  })

  it('fetches TURN credentials for the negotiated connection', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => jsonResponse({
      iceServers: [{ urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' }],
    }))
    const api = new RemoteServerApi('https://remote.example.com', 'access-token-for-client', fetchImplementation)
    const ice = await api.turnCredentials('connection-1')
    expect(ice).toEqual([{ urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' }])
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      'https://remote.example.com/api/v1/turn/credentials?connection_id=connection-1',
    )
  })

  it('preserves stable Server error codes and retryability', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => jsonResponse({
      error: { code: 'MEMBERSHIP_REQUIRED', message: 'membership revoked', retryable: false },
    }, 403))
    const api = new RemoteServerApi('https://remote.example.com', 'access-token-for-client', fetchImplementation)
    await expect(api.deviceFor('host-1')).rejects.toMatchObject({
      code: 'MEMBERSHIP_REQUIRED',
      status: 403,
      retryable: false,
    })
  })

  it('reports whether the server has Zhihu OAuth configured', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => jsonResponse({ configured: true }))
    const api = new RemoteServerApi('https://remote.example.com', undefined, fetchImplementation)
    await expect(api.oauthStatus()).resolves.toEqual({ configured: true })
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe('https://remote.example.com/api/v1/auth/oauth/status')
  })

  it('reports whether the server has GitHub OAuth configured', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => jsonResponse({ configured: true }))
    const api = new RemoteServerApi('https://remote.example.com', undefined, fetchImplementation)
    await expect(api.oauthGithubStatus()).resolves.toEqual({ configured: true })
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe('https://remote.example.com/api/v1/auth/oauth/github/status')
  })
})

function tokenPair(suffix: string) {
  return {
    accessToken: `access-${suffix}-token`,
    accessTokenExpiresAt: Date.now() + 60_000,
    refreshToken: `refresh-${suffix}-token`,
    refreshTokenExpiresAt: Date.now() + 120_000,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
