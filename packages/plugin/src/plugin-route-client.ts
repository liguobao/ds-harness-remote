import { CONTROL_RPC_PREFIX } from './control-route.js'

type Fetch = typeof globalThis.fetch

class PluginRouteFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) { super(message) }
}

const KNOWN_ERROR_NAMES = new Set([
  'TimeoutError',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'URIError',
  'EvalError',
  'Error',
  'AbortError',
  'DOMException',
])

function sanitizeErrorName(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name
    if (typeof name === 'string' && KNOWN_ERROR_NAMES.has(name)) return name
  }
  return 'Error'
}

/** A timeout is distinguishable from a caller abort: only the former may be retried. */
function isTimeoutError(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current !== undefined && current !== null && depth < 4; depth++) {
    if (typeof current !== 'object') return false
    const candidate = current as { name?: unknown; code?: unknown; cause?: unknown }
    if (candidate.name === 'TimeoutError') return true
    if (candidate.code === 'UND_ERR_CONNECT_TIMEOUT' || candidate.code === 'ETIMEDOUT') return true
    current = candidate.cause
  }
  return false
}

function isAbortFailure(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted === true) return true
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

export interface PluginRouteClientOptions {
  /** Publish a remote roster only after the official Session catalog has caught up. */
  beforeResponse?(status: Record<string, unknown>, body: Record<string, unknown>, json: unknown, signal: AbortSignal): Promise<void>
}

/** Route authority is read before each plugin request, including the first page load. */
export function createPluginRouteFetch(original: Fetch, baseUrl: string, options: PluginRouteClientOptions = {}): Fetch {
  const routeUrl = new URL('api/bot', baseUrl)
  let nextRpcId = 0

  const control = async (method: string, payload: unknown, signal?: AbortSignal): Promise<unknown> => {
    const rpcId = `plugin-route-${++nextRpcId}`
    let response: Response
    try {
      response = await original(new URL(`${CONTROL_RPC_PREFIX.slice(1)}/${method}`, baseUrl), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
        signal,
      })
    } catch (error) {
      // A caller abort or an expired deadline is cancellation, not a dead
      // control channel, so it must keep propagating as `AbortError`.
      if (isAbortFailure(error, signal) || isTimeoutError(error)) throw error
      throw new PluginRouteFailure('remote-plugin/control-unavailable', 'The local Remote control request failed. Reload the Remote plugin.', {
        stage: 'transport',
        method,
        errorName: sanitizeErrorName(error),
      })
    }
    if (!response.ok) {
      throw new PluginRouteFailure('remote-plugin/control-unavailable', `The local Remote control request failed (HTTP ${response.status}). Reload the Remote plugin.`, {
        stage: 'transport',
        method,
        httpStatus: response.status,
      })
    }
    const envelope: unknown = await response.json()
    if (!isRecord(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId
      || !isRecord(envelope.result)) {
      throw new PluginRouteFailure('remote-plugin/control-invalid', 'The local Remote control response is invalid. Reload the Remote plugin.')
    }
    if (envelope.result.ok !== true) {
      const error = isRecord(envelope.result.error) ? envelope.result.error : undefined
      const details = isRecord(error?.details) ? error.details : undefined
      const code = details?.remoteCode ?? error?.code
      if (code === 'FEATURE_NOT_SUPPORTED' || code === 'METHOD_NOT_FOUND') {
        throw new PluginRouteFailure('remote-plugin/host-unsupported', 'The selected Host does not support plugin route forwarding. Update and reload Remote on the Host, then reconnect.')
      }
      if (code === 'REMOTE_NOT_CONNECTED' || code === 'TRANSPORT_CLOSED') {
        throw new PluginRouteFailure('remote-plugin/disconnected', 'The Remote Host is disconnected. Reconnect to load DS Bot.')
      }
      if (code === 'INVALID_MESSAGE') {
        throw new PluginRouteFailure('remote-plugin/operation-not-allowed', 'This DS Bot operation is not allowed over Remote. Use the Host locally.')
      }
      throw new PluginRouteFailure('remote-plugin/control-rejected', 'The Remote plugin route request was rejected by the control channel.')
    }
    return envelope.result.value
  }

  return async (input, init) => {
    const requestUrl = new URL(input instanceof Request ? input.url : String(input), baseUrl)
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    if (method.toUpperCase() !== 'POST' || requestUrl.href !== routeUrl.href) return original(input, init)
    const signal = init?.signal !== undefined ? init.signal ?? undefined : input instanceof Request ? input.signal : undefined
    const lifetime = signal ?? AbortSignal.timeout(45_000)
    try {
      lifetime.throwIfAborted()
      // The 10s probe deadline is ours, not the caller's: while the outer
      // lifetime is still live, a probe timeout means the local control
      // channel is wedged, which needs a distinct reload-the-plugin signal.
      let status: unknown
      const probeTimeout = AbortSignal.timeout(10_000)
      const probeSignal = AbortSignal.any([lifetime, probeTimeout])
      try {
        status = await control('status', {}, probeSignal)
      } catch (error) {
        if (error instanceof PluginRouteFailure) throw error
        lifetime.throwIfAborted()
        if (probeTimeout.aborted) {
          throw new PluginRouteFailure('remote-plugin/control-timeout', 'The local Remote control probe timed out. Reload the Remote plugin.', {
            stage: 'status',
            timeoutMs: 10_000,
            errorName: sanitizeErrorName(error),
          })
        }
        if (isTimeoutError(error)) {
          throw new PluginRouteFailure('remote-plugin/control-timeout', 'The local Remote control request timed out. Reload the Remote plugin.', {
            stage: 'transport',
            method: 'status',
            errorName: sanitizeErrorName(error),
          })
        }
        throw error
      }
      lifetime.throwIfAborted()
      if (!isRecord(status)) throw new PluginRouteFailure('remote-plugin/authority-unavailable', 'The Remote plugin route authority is unavailable.')
      if (status.mode === 'local') return original(input, init)
      // Once Remote owns the page, never read the local plugin's roster on a
      // disconnect, missing capability, or virtual CodeX/ACP Session catalog.
      if (status.mode !== 'remote') throw new PluginRouteFailure('remote-plugin/authority-unavailable', 'The Remote plugin route authority is unavailable.')
      if (status.connected !== true) throw new PluginRouteFailure('remote-plugin/disconnected', 'The Remote Host is disconnected. Reconnect to load DS Bot.')
      if (!isRecord(status.remoteFeatures) || status.remoteFeatures.pluginRoute !== true) throw new PluginRouteFailure('remote-plugin/host-unsupported', 'The selected Host does not support plugin route forwarding. Update and reload Remote on the Host, then reconnect.')
      if (status.backend !== undefined && status.backend !== 'harness') throw new PluginRouteFailure('remote-plugin/backend-unsupported', 'DS Bot requires the Remote Harness catalog. Select a Harness workspace on this Host.')
      const request = input instanceof Request
        ? new Request(input, init)
        : new Request(requestUrl, init)
      const body: unknown = await request.clone().json().catch((error: unknown) => {
        throw new PluginRouteFailure('remote-plugin/route-request-invalid', 'The plugin route body must be a JSON object.', {
          stage: 'request-body',
          errorName: sanitizeErrorName(error),
        })
      })
      if (!isRecord(body)) {
        throw new PluginRouteFailure('remote-plugin/route-request-invalid', 'The plugin route body must be a JSON object.', { stage: 'request-body' })
      }
      const result = await control('plugin.route', { route: 'api/bot', body }, lifetime)
      if (!isRecord(result) || !Number.isInteger(result.status)
        || (result.status as number) < 200 || (result.status as number) > 599) {
        throw new PluginRouteFailure('remote-plugin/route-response-invalid', 'The plugin route response is invalid.', { stage: 'response-structure' })
      }
      const statusCode = result.status as number
      if (statusCode === 404) throw new PluginRouteFailure('remote-plugin/bot-not-loaded', 'The Host has no DS Bot route. Enable ds-bot in the same DSH instance/profile as the connected Host.')
      if (statusCode === 503) throw new PluginRouteFailure('remote-plugin/host-carrier-unavailable', 'The Host plugin route carrier is unavailable. Update and reload Remote on the Host.')
      if (statusCode >= 200 && statusCode < 300 && options.beforeResponse !== undefined) {
        try {
          await waitWithSignal(options.beforeResponse(status, body, result.json, lifetime), lifetime)
        } catch {
          lifetime.throwIfAborted()
          throw new PluginRouteFailure('remote-plugin/catalog-unavailable', 'The Remote Harness Session catalog is not ready. Reconnect before loading DS Bot.')
        }
      }
      lifetime.throwIfAborted()
      return new Response([204, 205, 304].includes(statusCode) ? null : JSON.stringify(result.json ?? null), {
        status: statusCode,
        headers: { 'content-type': 'application/json' },
      })
    } catch (error) {
      lifetime.throwIfAborted()
      // Unexpected failures collapse into one stable code: the original
      // message may carry private upstream data and must never be echoed.
      const failure = error instanceof PluginRouteFailure ? error
        : isTimeoutError(error)
          ? new PluginRouteFailure('remote-plugin/control-timeout', 'The Remote plugin route request timed out. Reload the Remote plugin.', {
            stage: 'route',
            errorName: sanitizeErrorName(error),
          })
          : new PluginRouteFailure('remote-plugin/unavailable', 'The Remote plugin route is unavailable.', {
            errorName: sanitizeErrorName(error),
          })
      // DS Bot reads its error envelope only for HTTP success. A synthetic 502
      // hides every refusal behind "HTTP 502" before it can read the reason.
      return new Response(JSON.stringify({
        ok: false,
        error: {
          code: failure.code,
          message: failure.message,
          details: failure.details,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  }
}

export interface PluginRouteSessions {
  list: { getSnapshot(): { ids: readonly string[]; phase: string } }
  refresh?(): Promise<void>
}

/** `ready` is monotone in Harness; prove membership instead of trusting refresh's void result. */
export function createPluginRouteCatalogGuard(
  readSessions: () => Promise<PluginRouteSessions>,
): NonNullable<PluginRouteClientOptions['beforeResponse']> {
  return async (_status, body, json, signal) => {
    if (!isRecord(json) || json.ok !== true || !isRecord(json.value)) return
    const required = botSessionIds(body.endpoint, json.value)
    if (required.size === 0) return
    const sessions = await readSessions()
    const containsSessions = () => {
      const snapshot = sessions.list.getSnapshot()
      const known = new Set(snapshot.ids)
      return snapshot.phase === 'ready' && [...required].every(id => known.has(id))
    }
    // A first refresh may join a pull that started before the Bot mutation.
    // One further pull lets that in-flight baseline finish without an unbounded retry loop.
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted()
      if (containsSessions()) return
      if (sessions.refresh === undefined) break
      await sessions.refresh()
    }
    signal.throwIfAborted()
    if (!containsSessions()) throw new Error('The Remote Session catalog does not contain the published Sessions.')
  }
}

function botSessionIds(endpoint: unknown, value: Record<string, unknown>): Set<string> {
  const ids = new Set<string>()
  const add = (id: unknown) => {
    if (id === undefined || id === null) return
    if (typeof id !== 'string' || id.length === 0) throw new Error('Invalid Bot Session identity.')
    ids.add(id)
  }
  const addArray = (input: unknown) => {
    if (input === undefined) return
    if (!Array.isArray(input)) throw new Error('Invalid Bot Session identities.')
    input.forEach(add)
  }
  const bot = (input: unknown) => {
    if (!isRecord(input)) throw new Error('Invalid Bot catalog entry.')
    add(input.id)
    add(input.sessionId)
    addArray(input.parts)
    if (Array.isArray(input.segments)) input.segments.forEach(segment => {
      if (!isRecord(segment)) throw new Error('Invalid Bot Session segment.')
      add(segment.sessionId)
    })
  }
  const room = (input: unknown) => {
    if (!isRecord(input)) throw new Error('Invalid Bot room entry.')
    add(input.id)
    add(input.sessionId)
    addArray(input.ownParts)
    addArray(input.parts)
    if (isRecord(input.sessions)) Object.values(input.sessions).forEach(add)
  }
  const agent = (input: unknown) => {
    if (!isRecord(input)) throw new Error('Invalid Bot agent entry.')
    // Agent IDs are roster identities, not Harness Session IDs.
    addArray(input.sessions)
  }
  const roster = () => {
    for (const [key, visit] of [['bots', bot], ['rooms', room], ['agents', agent]] as const) {
      if (value[key] === undefined) continue
      if (!Array.isArray(value[key])) throw new Error('Invalid Bot roster.')
      value[key].forEach(visit)
    }
  }
  switch (endpoint) {
    case 'state': case 'delete-bot': case 'delete-room': case 'set-main': case 'remove-agent': case 'goal-draft': case 'goal-control': roster(); break
    case 'create-bot': case 'duplicate-bot': case 'update-bot': bot(value); break
    case 'create-room': room(value); break
    case 'update-room': room(value.room); break
    case 'add-agent': agent(value); break
    case 'agent-session': case 'agent-adopt': add(value.sessionId); break
    case 'set-flags': Array.isArray(value.sessions) ? agent(value) : Array.isArray(value.members) ? room(value) : bot(value); break
  }
  return ids
}

function waitWithSignal<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    void pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
