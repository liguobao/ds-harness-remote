import appConfig from '../../app.json'
import { MAX_DEVICE_NAME_LENGTH, deviceTokenPairSchema, type DeviceTokenPair as TokenPair } from '@dsh-remote/protocol'
import { RemoteApiError } from '../lib/errors'
import { normalizeServerUrl } from '../lib/server-url'
import type {
  DeviceCredentials,
  DeviceIdentity,
  DevicePresence,
  RemoteDevice,
} from '../types'

interface ErrorBody {
  detail?: unknown
  code?: unknown
  error?: {
    code?: unknown
    message?: unknown
    retryable?: unknown
  }
}

interface AccountLoginResult {
  token: string
  expiresAt: number
  account: string
  isAdmin: boolean
}

export interface AuthorizedPeerDevice {
  deviceId: string
  name: string
  role: 'host' | 'client'
  platform: string
  identityKey: string
  membershipId: string
  online?: boolean
  lastSeenAt?: number
  clientVersion?: string
  harnessVersion?: string
}

export interface RtcIceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

type FetchImplementation = typeof fetch

export class RemoteServerApi {
  readonly baseUrl: string

  constructor(
    baseUrl: string,
    private readonly accessToken?: string,
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly timeoutMs = 10_000,
  ) {
    this.baseUrl = normalizeServerUrl(baseUrl)
  }

  async health(): Promise<void> {
    const body = await this.request<unknown>('/health', {}, false)
    if (!isRecord(body) || body.status !== 'ok') {
      throw new RemoteApiError('CONNECTION_FAILED', 'The server health check failed.')
    }
  }

  /** Whether the server has Zhihu OAuth configured for account sign-in. */
  async oauthStatus(): Promise<{ configured: boolean }> {
    const body = await this.request<unknown>('/api/v1/auth/oauth/status', {}, false)
    if (!isRecord(body) || typeof body.configured !== 'boolean') invalidResponse('oauth status')
    return { configured: body.configured }
  }

  /** Whether the server has GitHub OAuth configured for account sign-in. */
  async oauthGithubStatus(): Promise<{ configured: boolean }> {
    const body = await this.request<unknown>('/api/v1/auth/oauth/github/status', {}, false)
    if (!isRecord(body) || typeof body.configured !== 'boolean') invalidResponse('GitHub oauth status')
    return { configured: body.configured }
  }

  async accountMe(accountToken: string): Promise<{ account: string }> {
    const body = await this.request<unknown>('/api/v1/auth/me', {}, false, accountToken)
    if (!isRecord(body) || typeof body.account !== 'string' || body.account.length === 0) invalidResponse('account profile')
    return { account: body.account }
  }

  async removeSelf(): Promise<void> {
    await this.request('/api/v1/devices/self', { method: 'DELETE' })
  }

  /** Remove an account-owned Host, matching the Web device removal operation. */
  async removeAccountDevice(deviceId: string): Promise<void> {
    await this.request(`/api/v1/account/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' })
  }

  /** Rename an account-owned Host using the same endpoint as Web management. */
  async renameAccountDevice(deviceId: string, name: string): Promise<{ name: string }> {
    const trimmed = name.trim()
    if (trimmed.length === 0 || trimmed.length > MAX_DEVICE_NAME_LENGTH) {
      throw new RemoteApiError('INVALID_MESSAGE', 'Enter a device name between 1 and 128 characters.')
    }
    const body = await this.request<unknown>(`/api/v1/account/devices/${encodeURIComponent(deviceId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: trimmed }),
    })
    if (!isRecord(body) || typeof body.name !== 'string' || body.name.trim().length === 0
      || body.name.length > MAX_DEVICE_NAME_LENGTH) invalidResponse('renamed device')
    return { name: body.name }
  }

  /** Account password login; the returned token only authorizes device registration. */
  async loginAccount(email: string, password: string): Promise<AccountLoginResult> {
    const body = await this.request<unknown>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim(), password }),
    }, false)
    if (!isRecord(body)
      || typeof body.token !== 'string' || body.token.length < 16
      || typeof body.account !== 'string' || body.account.length === 0
      || typeof body.expiresAt !== 'number' || !Number.isSafeInteger(body.expiresAt)
      || typeof body.isAdmin !== 'boolean') {
      invalidResponse('account login')
    }
    return {
      token: body.token,
      expiresAt: body.expiresAt,
      account: body.account,
      isAdmin: body.isAdmin,
    }
  }

  /** Register this Android client under the account token. */
  async registerDevice(identity: DeviceIdentity, accountToken: string): Promise<TokenPair> {
    const body = await this.request<unknown>('/api/v1/devices/register', {
      method: 'POST',
      body: JSON.stringify({
        v: 1,
        device: {
          deviceId: identity.deviceId,
          name: identity.name,
          role: 'client',
          platform: identity.platform,
          identityKey: identity.publicKey,
          clientVersion: ANDROID_CLIENT_VERSION,
        },
      }),
    }, false, accountToken)
    return parseTokenPair(body)
  }

  async refreshToken(deviceId: string, refreshToken: string): Promise<TokenPair> {
    const body = await this.request<unknown>('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ deviceId, refreshToken }),
    }, false)
    return parseTokenPair(body)
  }

  /** Hosts visible through same-account membership. */
  async listDevices(): Promise<RemoteDevice[]> {
    const body = await this.request<unknown>('/api/v1/devices')
    if (!isRecord(body) || !Array.isArray(body.items)) invalidResponse('device list')
    return body.items.flatMap(parseHostDevice)
  }

  /** Authorized peer descriptor including the identity key used for Noise pinning. */
  async deviceFor(deviceId: string): Promise<AuthorizedPeerDevice> {
    const body = await this.request<unknown>(`/api/v1/devices/${encodeURIComponent(deviceId)}`)
    return parseAuthorizedPeer(body)
  }

  async getPresence(deviceId: string): Promise<DevicePresence> {
    const body = await this.request<unknown>(`/api/v1/devices/${encodeURIComponent(deviceId)}/presence`)
    if (!isRecord(body)
      || typeof body.deviceId !== 'string'
      || typeof body.online !== 'boolean'
      || (body.lastSeenAt !== null && body.lastSeenAt !== undefined && !Number.isSafeInteger(body.lastSeenAt))) {
      invalidResponse('device presence')
    }
    return {
      deviceId: body.deviceId,
      online: body.online,
      ...(typeof body.lastSeenAt === 'number' ? { lastSeenAt: body.lastSeenAt } : {}),
    }
  }

  async turnCredentials(connectionId: string): Promise<RtcIceServer[]> {
    const body = await this.request<unknown>(
      `/api/v1/turn/credentials?connection_id=${encodeURIComponent(connectionId)}`,
    )
    if (!isRecord(body) || !Array.isArray(body.iceServers)) return []
    return body.iceServers.flatMap(parseIceServer)
  }

  private async request<TResult>(
    path: string,
    init: RequestInit = {},
    authenticated = true,
    accountToken?: string,
  ): Promise<TResult> {
    const bearer = accountToken ?? this.accessToken
    if (authenticated && bearer === undefined) {
      throw new RemoteApiError('AUTH_REQUIRED', 'This device is not registered with the server.')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let response: Response
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` }),
          ...init.headers,
        },
      })
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError'
      throw new RemoteApiError(
        'CONNECTION_FAILED',
        timedOut ? 'The server request timed out.' : error instanceof Error ? error.message : 'Server request failed.',
        undefined,
        true,
      )
    } finally {
      clearTimeout(timer)
    }

    const text = await response.text()
    let body: unknown = undefined
    if (text.length > 0) {
      try {
        body = JSON.parse(text)
      } catch {
        throw new RemoteApiError('INVALID_MESSAGE', 'The server returned invalid JSON.', response.status)
      }
    }
    if (!response.ok) {
      const errorBody = (body ?? {}) as ErrorBody
      const detail = typeof errorBody.error?.message === 'string'
        ? errorBody.error.message
        : typeof errorBody.detail === 'string' ? errorBody.detail : 'The server rejected the request.'
      const code = mapStatus(response.status, detail, errorBody.error?.code ?? errorBody.code)
      throw new RemoteApiError(code, detail, response.status, errorBody.error?.retryable === true || response.status >= 500)
    }
    return body as TResult
  }
}

/** Keep Server device metadata aligned with the version embedded in the native APK. */
export const ANDROID_CLIENT_VERSION = appConfig.expo.version

function parseTokenPair(input: unknown): TokenPair {
  const parsed = deviceTokenPairSchema.safeParse(input)
  if (!parsed.success) invalidResponse('device credentials')
  return parsed.data
}

function parseHostDevice(input: unknown): RemoteDevice[] {
  if (!isRecord(input)
    || typeof input.deviceId !== 'string'
    || typeof input.name !== 'string'
    || typeof input.platform !== 'string'
    || input.role !== 'host'
    || typeof input.membershipId !== 'string'
    || input.membershipId.length === 0) {
    return []
  }
  return [{
    deviceId: input.deviceId,
    name: input.name,
    platform: input.platform,
    role: 'host',
    membershipId: input.membershipId,
    identityKey: '',
    online: input.online === true,
    trusted: false,
    ...(typeof input.clientVersion === 'string' ? { clientVersion: input.clientVersion } : {}),
    ...(typeof input.harnessVersion === 'string' ? { harnessVersion: input.harnessVersion } : {}),
    ...(typeof input.lastSeenAt === 'number' ? { lastSeenAt: input.lastSeenAt } : {}),
  }]
}

function parseAuthorizedPeer(input: unknown): AuthorizedPeerDevice {
  if (!isRecord(input)
    || (input.role !== 'host' && input.role !== 'client')
    || typeof input.deviceId !== 'string' || input.deviceId.length === 0
    || typeof input.name !== 'string' || input.name.length === 0
    || typeof input.platform !== 'string'
    || typeof input.identityKey !== 'string' || input.identityKey.length === 0
    || typeof input.membershipId !== 'string' || input.membershipId.length === 0) {
    invalidResponse('authorized peer')
  }
  return {
    deviceId: input.deviceId,
    name: input.name,
    role: input.role,
    platform: input.platform,
    identityKey: input.identityKey,
    membershipId: input.membershipId,
    ...(typeof input.online === 'boolean' ? { online: input.online } : {}),
    ...(typeof input.lastSeenAt === 'number' ? { lastSeenAt: input.lastSeenAt } : {}),
    ...(typeof input.clientVersion === 'string' ? { clientVersion: input.clientVersion } : {}),
    ...(typeof input.harnessVersion === 'string' ? { harnessVersion: input.harnessVersion } : {}),
  }
}

function parseIceServer(input: unknown): RtcIceServer[] {
  if (!isRecord(input)) return []
  const urls = input.urls
  if (typeof urls !== 'string' && !(Array.isArray(urls) && urls.every(url => typeof url === 'string'))) return []
  return [{
    urls,
    ...(typeof input.username === 'string' ? { username: input.username } : {}),
    ...(typeof input.credential === 'string' ? { credential: input.credential } : {}),
  }]
}

function invalidResponse(name: string): never {
  throw new RemoteApiError('INVALID_MESSAGE', `The server returned invalid ${name} data.`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function mapStatus(status: number, detail: string, serverCode: unknown): string {
  if (typeof serverCode === 'string') return serverCode
  if (status === 401) return 'AUTH_INVALID'
  if (status === 403) return 'AUTH_REQUIRED'
  if (status === 404) return 'DEVICE_NOT_FOUND'
  if (status === 409) return 'DEVICE_OWNERSHIP_REQUIRED'
  if (status === 429) return 'RATE_LIMITED'
  return status >= 500 ? 'CONNECTION_FAILED' : 'INVALID_MESSAGE'
}
