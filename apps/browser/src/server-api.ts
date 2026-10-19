import {
  browserAuthorizationExchangeResponseSchema,
  deviceTokenPairSchema,
  type DeviceTokenPair as TokenPair,
} from '@dsh-remote/protocol'
import type { Credentials, DeviceIdentity, RemoteHost } from './types.js'

const CLIENT_VERSION = '0.5.13'

export class ServerApi {
  readonly baseUrl: string

  constructor(url: string, private readonly token?: string) {
    this.baseUrl = normalizeUrl(url)
  }

  /** Exchange the current Web authorization for this extension's own device credentials. */
  async exchangeBrowserAuthorization(identity: DeviceIdentity): Promise<Credentials> {
    const value = await this.request('/api/v1/auth/browser-authorizations/exchange', {
      method: 'POST',
      body: JSON.stringify({
        v: 1,
        device: {
          deviceId: identity.deviceId,
          name: identity.name,
          role: 'client',
          platform: identity.platform,
          identityKey: identity.publicKey,
          clientVersion: CLIENT_VERSION,
        },
      }),
    })
    const parsed = browserAuthorizationExchangeResponseSchema.safeParse(value)
    if (!parsed.success) throw new Error('Server returned an invalid browser authorization.')
    return { serverUrl: this.baseUrl, deviceId: identity.deviceId, ...parsed.data }
  }

  async refresh(deviceId: string, refreshToken: string, account: string): Promise<Credentials> {
    const value = await this.request('/api/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ deviceId, refreshToken }) }, false)
    return { serverUrl: this.baseUrl, deviceId, account, ...tokenPair(value) }
  }

  async removeSelf(): Promise<void> {
    await this.request('/api/v1/devices/self', { method: 'DELETE' })
  }

  async hosts(): Promise<RemoteHost[]> {
    const value = record(await this.request('/api/v1/devices'), 'device list')
    if (!Array.isArray(value.items)) throw new Error('Server returned an invalid device list.')
    const hosts = value.items.filter(item => isRecord(item) && item.role === 'host' && typeof item.deviceId === 'string')
    return Promise.all(hosts.map(async item => {
      const deviceId = item.deviceId as string
      const presence = await this.presence(deviceId).catch(() => undefined)
      return {
        deviceId,
        name: typeof item.name === 'string' ? item.name : deviceId,
        platform: typeof item.platform === 'string' ? item.platform : 'unknown',
        // Presence is the authoritative live state. Fail closed when it cannot
        // be read: list snapshots must never be presented as current presence.
        online: presence?.online === true,
        ...(typeof presence?.lastSeenAt === 'number'
          ? { lastSeenAt: presence.lastSeenAt }
          : typeof item.lastSeenAt === 'number'
            ? { lastSeenAt: item.lastSeenAt }
            : {}),
        ...(typeof item.harnessVersion === 'string' ? { harnessVersion: item.harnessVersion } : {}),
      }
    }))
  }

  private async presence(deviceId: string): Promise<{ online: boolean; lastSeenAt?: number }> {
    const body = record(await this.request(`/api/v1/devices/${encodeURIComponent(deviceId)}/presence`), 'device presence')
    if (body.deviceId !== deviceId
      || typeof body.online !== 'boolean'
      || (body.lastSeenAt !== null && body.lastSeenAt !== undefined && !Number.isSafeInteger(body.lastSeenAt))) {
      throw new Error('Server returned an invalid device presence.')
    }
    return {
      online: body.online,
      ...(typeof body.lastSeenAt === 'number' ? { lastSeenAt: body.lastSeenAt } : {}),
    }
  }

  private async request(path: string, init: RequestInit = {}, authenticated = true, overrideToken?: string): Promise<unknown> {
    const token = overrideToken ?? this.token
    if (authenticated && token === undefined) throw new Error('Authorize this launcher first.')
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(10_000),
    })
    const text = await response.text()
    const body: unknown = text ? JSON.parse(text) : undefined
    if (!response.ok) {
      const error = isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string' ? body.error.message : `Server request failed (${response.status}).`
      throw new Error(error)
    }
    return body
  }
}

function normalizeUrl(value: string): string {
  const url = new URL(value.trim())
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname))) throw new Error('Use HTTPS (HTTP is allowed only for localhost).')
  return url.origin
}

function tokenPair(input: unknown): TokenPair {
  const parsed = deviceTokenPairSchema.safeParse(input)
  if (!parsed.success) throw new Error('Server returned invalid device credentials.')
  return parsed.data
}
function record(value: unknown, label: string): Record<string, unknown> { if (!isRecord(value)) throw new Error(`Server returned an invalid ${label}.`); return value }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
