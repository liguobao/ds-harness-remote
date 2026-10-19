import { deviceTokenPairSchema, type DeviceTokenPair as TokenPair } from '@dsh-remote/protocol'
import type { RtcIceServer } from '@dsh-remote/webrtc'
import type { Credentials, DeviceIdentity, RemoteHost } from './types.js'

const CLIENT_VERSION = '0.5.13'

export interface QrLoginSession { qrId: string; scanUrl: string; expiresIn: number }
export type QrLoginPoll = { status: 'pending' | 'expired' } | { status: 'complete'; token: string; account: string }

export class ServerApi {
  readonly baseUrl: string

  constructor(url: string, private readonly token?: string) {
    this.baseUrl = normalizeUrl(url)
  }

  async login(email: string, password: string): Promise<{ token: string; account: string }> {
    const value = await this.request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) }, false)
    const body = record(value, 'account login')
    if (typeof body.token !== 'string' || typeof body.account !== 'string') throw new Error('Server returned an invalid account login.')
    return { token: body.token, account: body.account }
  }

  /** Complete Client authorization after either password or QR account login. */
  async authorizeClient(identity: DeviceIdentity, accountToken: string, account: string): Promise<Credentials> {
    const value = await this.request('/api/v1/devices/register', {
      method: 'POST',
      body: JSON.stringify({ v: 1, device: { deviceId: identity.deviceId, name: identity.name, role: 'client', platform: identity.platform, identityKey: identity.publicKey, clientVersion: CLIENT_VERSION } }),
    }, false, accountToken)
    return { serverUrl: this.baseUrl, deviceId: identity.deviceId, account, ...tokenPair(value) }
  }

  async startQrLogin(): Promise<QrLoginSession> {
    const body = record(await this.request('/api/v1/auth/oauth/qr/start', { method: 'POST', body: '{}' }, false), 'QR login')
    if (typeof body.qrId !== 'string' || body.qrId.length < 20 || typeof body.scanUrl !== 'string' || !Number.isSafeInteger(body.expiresIn)) throw new Error('Server returned an invalid QR login session.')
    const scanUrl = new URL(body.scanUrl)
    if (scanUrl.origin !== this.baseUrl) throw new Error('Server returned an untrusted QR login URL.')
    return { qrId: body.qrId, scanUrl: body.scanUrl, expiresIn: body.expiresIn as number }
  }

  async pollQrLogin(qrId: string): Promise<QrLoginPoll> {
    const body = record(await this.request(`/api/v1/auth/oauth/qr/${encodeURIComponent(qrId)}`, {}, false), 'QR login status')
    if (body.status === 'pending' || body.status === 'expired') return { status: body.status }
    if (body.status !== 'complete' || typeof body.token !== 'string' || body.token.length < 16) throw new Error('Server returned an invalid QR login status.')
    const profile = record(await this.request('/api/v1/auth/me', {}, false, body.token), 'account profile')
    if (typeof profile.account !== 'string' || profile.account.length === 0) throw new Error('Server returned an invalid account profile.')
    return { status: 'complete', token: body.token, account: profile.account }
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
    const hosts: RemoteHost[] = []
    for (const item of value.items) {
      if (!isRecord(item) || item.role !== 'host' || typeof item.deviceId !== 'string') continue
      const descriptor = record(await this.request(`/api/v1/devices/${encodeURIComponent(item.deviceId)}`), 'host descriptor')
      if (typeof descriptor.identityKey !== 'string' || typeof descriptor.membershipId !== 'string') continue
      const presence = await this.presence(item.deviceId).catch(() => undefined)
      hosts.push({
        deviceId: item.deviceId,
        name: typeof descriptor.name === 'string' ? descriptor.name : typeof item.name === 'string' ? item.name : item.deviceId,
        platform: typeof descriptor.platform === 'string' ? descriptor.platform : 'unknown',
        identityKey: descriptor.identityKey,
        membershipId: descriptor.membershipId,
        // Presence is the authoritative live state. Fail closed when it cannot
        // be read: descriptor/list snapshots may retain online=true after a Host
        // disconnects and must never be presented as current presence.
        online: presence?.online === true,
        ...(typeof presence?.lastSeenAt === 'number'
          ? { lastSeenAt: presence.lastSeenAt }
          : typeof descriptor.lastSeenAt === 'number'
            ? { lastSeenAt: descriptor.lastSeenAt }
            : {}),
        ...(typeof descriptor.clientVersion === 'string' ? { clientVersion: descriptor.clientVersion } : {}),
        ...(typeof descriptor.harnessVersion === 'string' ? { harnessVersion: descriptor.harnessVersion } : {}),
      })
    }
    return hosts
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

  async turnCredentials(connectionId: string): Promise<RtcIceServer[]> {
    const body = record(await this.request(
      `/api/v1/turn/credentials?connection_id=${encodeURIComponent(connectionId)}`,
    ), 'TURN credentials')
    if (!Array.isArray(body.iceServers)) return []
    return body.iceServers.flatMap(parseIceServer)
  }

  private async request(path: string, init: RequestInit = {}, authenticated = true, overrideToken?: string): Promise<unknown> {
    const token = overrideToken ?? this.token
    if (authenticated && token === undefined) throw new Error('Sign in first.')
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
function parseIceServer(input: unknown): RtcIceServer[] {
  if (!isRecord(input)) return []
  const urls = typeof input.urls === 'string'
    ? input.urls
    : Array.isArray(input.urls) && input.urls.every(value => typeof value === 'string')
      ? input.urls as string[]
      : undefined
  if (urls === undefined) return []
  return [{
    urls,
    ...(typeof input.username === 'string' ? { username: input.username } : {}),
    ...(typeof input.credential === 'string' ? { credential: input.credential } : {}),
  }]
}
function record(value: unknown, label: string): Record<string, unknown> { if (!isRecord(value)) throw new Error(`Server returned an invalid ${label}.`); return value }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
