import {
  liveActivityTokenRegistrationRequestSchema,
  pushTargetRegistrationRequestSchema,
  type LiveActivityTokenRegistrationRequest,
  type PushTargetRegistrationRequest,
} from '@dsh-remote/protocol'

export type PushTargetResult =
  | { ok: true }
  | { ok: false; unsupported: true }

export type PushTargetClientErrorCode =
  | 'INVALID_BASE_URL'
  | 'INSECURE_BASE_URL'
  | 'INVALID_ACCESS_TOKEN'
  | 'INVALID_HOST_ID'
  | 'INVALID_PAYLOAD'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'INVALID_REQUEST'
  | 'HTTP_ERROR'
  | 'REQUEST_ABORTED'
  | 'NETWORK_ERROR'

export class PushTargetClientError extends Error {
  constructor(
    readonly code: PushTargetClientErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'PushTargetClientError'
  }
}

export interface PushTargetResponseLike {
  readonly ok: boolean
  readonly status: number
  readonly body?: { cancel?: () => Promise<unknown> } | null
}

export type PushTargetFetch = (input: string, init?: RequestInit) => Promise<PushTargetResponseLike>

export interface PushTargetRequestOptions {
  signal?: AbortSignal
}

const MAX_HOST_ID_LENGTH = 256
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/**
 * Registers the current authenticated client device's APNs/FCM wake token on a
 * Hosted Server advertising `push.wake.v1`.
 */
export async function registerPushTarget(
  baseUrl: string,
  accessToken: string,
  payload: PushTargetRegistrationRequest,
  fetchImpl: PushTargetFetch = globalThis.fetch,
  options?: PushTargetRequestOptions,
): Promise<PushTargetResult> {
  const endpoint = buildEndpointUrl(baseUrl, '/api/v1/devices/self/push-target')
  const token = validateAccessToken(accessToken)
  const parsed = pushTargetRegistrationRequestSchema.safeParse(payload)
  if (!parsed.success) {
    throw new PushTargetClientError('INVALID_PAYLOAD', 'Invalid push target registration payload.')
  }
  return executePushTargetRequest(
    fetchImpl,
    endpoint,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(parsed.data),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    },
    'Push target registration',
    options?.signal,
  )
}

/**
 * Unregisters the current authenticated client device's APNs/FCM wake token on
 * a Hosted Server advertising `push.wake.v1`.
 */
export async function unregisterPushTarget(
  baseUrl: string,
  accessToken: string,
  fetchImpl: PushTargetFetch = globalThis.fetch,
  options?: PushTargetRequestOptions,
): Promise<PushTargetResult> {
  const endpoint = buildEndpointUrl(baseUrl, '/api/v1/devices/self/push-target')
  const token = validateAccessToken(accessToken)
  return executePushTargetRequest(
    fetchImpl,
    endpoint,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    },
    'Push target unregistration',
    options?.signal,
  )
}

/**
 * Registers an iOS ActivityKit Live Activity push token for `hostId` on a
 * Hosted Server advertising `push.wake.v1`.
 */
export async function registerLiveActivityToken(
  baseUrl: string,
  accessToken: string,
  hostId: string,
  payload: LiveActivityTokenRegistrationRequest,
  fetchImpl: PushTargetFetch = globalThis.fetch,
  options?: PushTargetRequestOptions,
): Promise<PushTargetResult> {
  const safeHostId = validateHostId(hostId)
  const endpoint = buildEndpointUrl(baseUrl, `/api/v1/devices/self/live-activities/${encodeURIComponent(safeHostId)}`)
  const token = validateAccessToken(accessToken)
  const parsed = liveActivityTokenRegistrationRequestSchema.safeParse(payload)
  if (!parsed.success) {
    throw new PushTargetClientError('INVALID_PAYLOAD', 'Invalid live activity token registration payload.')
  }
  return executePushTargetRequest(
    fetchImpl,
    endpoint,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(parsed.data),
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    },
    'Live Activity token registration',
    options?.signal,
  )
}

/**
 * Unregisters an iOS ActivityKit Live Activity push token for `hostId` on a
 * Hosted Server advertising `push.wake.v1`.
 */
export async function unregisterLiveActivityToken(
  baseUrl: string,
  accessToken: string,
  hostId: string,
  fetchImpl: PushTargetFetch = globalThis.fetch,
  options?: PushTargetRequestOptions,
): Promise<PushTargetResult> {
  const safeHostId = validateHostId(hostId)
  const endpoint = buildEndpointUrl(baseUrl, `/api/v1/devices/self/live-activities/${encodeURIComponent(safeHostId)}`)
  const token = validateAccessToken(accessToken)
  return executePushTargetRequest(
    fetchImpl,
    endpoint,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    },
    'Live Activity token unregistration',
    options?.signal,
  )
}

/** Stateful convenience wrapper around the Hosted Server `push.wake.v1` REST helpers. */
export class PushTargetClient {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string | (() => string),
    private readonly fetchImpl: PushTargetFetch = globalThis.fetch,
  ) {}

  registerPushTarget(
    payload: PushTargetRegistrationRequest,
    options?: PushTargetRequestOptions,
  ): Promise<PushTargetResult> {
    return registerPushTarget(this.baseUrl, this.resolveAccessToken(), payload, this.fetchImpl, options)
  }

  unregisterPushTarget(options?: PushTargetRequestOptions): Promise<PushTargetResult> {
    return unregisterPushTarget(this.baseUrl, this.resolveAccessToken(), this.fetchImpl, options)
  }

  registerLiveActivityToken(
    hostId: string,
    payload: LiveActivityTokenRegistrationRequest,
    options?: PushTargetRequestOptions,
  ): Promise<PushTargetResult> {
    return registerLiveActivityToken(this.baseUrl, this.resolveAccessToken(), hostId, payload, this.fetchImpl, options)
  }

  unregisterLiveActivityToken(
    hostId: string,
    options?: PushTargetRequestOptions,
  ): Promise<PushTargetResult> {
    return unregisterLiveActivityToken(this.baseUrl, this.resolveAccessToken(), hostId, this.fetchImpl, options)
  }

  private resolveAccessToken(): string {
    return typeof this.accessToken === 'function' ? this.accessToken() : this.accessToken
  }
}

export function createPushTargetClient(
  baseUrl: string,
  accessToken: string | (() => string),
  fetchImpl: PushTargetFetch = globalThis.fetch,
): PushTargetClient {
  return new PushTargetClient(baseUrl, accessToken, fetchImpl)
}

function buildEndpointUrl(baseUrl: string, path: string): string {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new PushTargetClientError('INVALID_BASE_URL', 'Push target server base URL is invalid.')
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new PushTargetClientError('INVALID_BASE_URL', 'Push target server base URL must not contain credentials.')
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new PushTargetClientError('INVALID_BASE_URL', 'Push target server base URL must not contain a query or hash.')
  }

  const protocol = parsed.protocol.toLowerCase()
  const hostname = parsed.hostname.toLowerCase()
  const isAllowed = protocol === 'https:' || (protocol === 'http:' && LOOPBACK_HOSTS.has(hostname))
  if (!isAllowed) {
    throw new PushTargetClientError(
      'INSECURE_BASE_URL',
      'Push target server URL must use https: or loopback http://127.0.0.1, localhost, or [::1].',
    )
  }

  const basePath = parsed.pathname.replace(/\/+$/, '')
  return `${parsed.origin}${basePath}${path}`
}

function validateAccessToken(accessToken: string): string {
  if (typeof accessToken !== 'string' || accessToken.trim().length === 0 || /[\r\n\0]/.test(accessToken)) {
    throw new PushTargetClientError('INVALID_ACCESS_TOKEN', 'A valid bearer access token is required.')
  }
  return accessToken
}

function validateHostId(hostId: string): string {
  if (typeof hostId !== 'string' || hostId.trim().length === 0 || hostId.length > MAX_HOST_ID_LENGTH || /[\r\n\0]/.test(hostId)) {
    throw new PushTargetClientError('INVALID_HOST_ID', 'A valid hostId is required.')
  }
  return hostId
}

async function executePushTargetRequest(
  fetchImpl: PushTargetFetch,
  endpoint: string,
  init: RequestInit,
  operationLabel: string,
  signal: AbortSignal | undefined,
): Promise<PushTargetResult> {
  if (typeof fetchImpl !== 'function') {
    throw new PushTargetClientError('NETWORK_ERROR', `${operationLabel} failed because fetch is unavailable.`)
  }

  let response: PushTargetResponseLike
  try {
    response = await fetchImpl(endpoint, init)
  } catch (error) {
    // Never propagate raw error messages or causes: custom fetch wrappers or
    // network layers may embed bearer/push tokens in thrown errors.
    if (signal?.aborted || isAbortError(error)) {
      throw new PushTargetClientError('REQUEST_ABORTED', `${operationLabel} was aborted.`)
    }
    throw new PushTargetClientError('NETWORK_ERROR', `${operationLabel} failed due to a network error.`)
  }

  await response.body?.cancel?.().catch(() => undefined)

  if (response.status === 404 || response.status === 501) {
    return { ok: false, unsupported: true }
  }
  if (response.ok) {
    return { ok: true }
  }

  // Never include response body text in thrown errors so echoed tokens cannot leak.
  throw new PushTargetClientError(
    statusToErrorCode(response.status),
    `${operationLabel} failed with HTTP ${response.status}.`,
    response.status,
  )
}

function statusToErrorCode(status: number): PushTargetClientErrorCode {
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 429) return 'RATE_LIMITED'
  if (status === 400 || status === 422) return 'INVALID_REQUEST'
  return 'HTTP_ERROR'
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}
