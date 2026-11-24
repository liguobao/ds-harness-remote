import { CONTROL_RPC_PREFIX } from './control-route.js'

type Fetch = typeof globalThis.fetch
/** Transport safety ceiling; the Host enforces its configured attachment limits. */
export const REMOTE_UPLOAD_MAX_BYTES = 192 * 1024 * 1024

/** Official upload hook: shared by browser, Desktop and IDE upload runtimes. */
export function createRemoteUploadFetch(original: Fetch, baseUrl: string): Fetch {
  let sequence = 0
  // Last mode the control route reported. A route that answered once and then answers 404/405 is
  // reloading or unmounted, which is not the same as never having had one.
  let lastMode: string | undefined
  const control = async (method: string, payload: unknown, signal: AbortSignal) => {
    const rpcId = `remote-upload-${++sequence}`
    const response = await original(new URL(`${CONTROL_RPC_PREFIX.slice(1)}/${method}`, baseUrl), {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload }), signal,
    })
    // A Host that never registered this prefix — an older plugin build on a newer DSH, or a
    // Remote UI whose Host runs no plugin — answers 404/405 to the status probe. Uploading then
    // is not a remote transfer at all, so fall back to the plain local request instead of failing
    // the user's upload before a single byte is sent.
    //
    // Only the status probe may degrade, and only while no remote Host has been observed: a route
    // that answered 404/405 *after* a successful remote handshake is going away under us, and
    // treating that as local would push a remote session's file to the local Host. Other methods
    // (`plugin.route`) must always surface their failure — an empty `{ mode: 'local' }` would be
    // turned into a 200 response upstream.
    if (method === 'status' && lastMode !== 'remote' && (response.status === 404 || response.status === 405)) {
      return { mode: 'local' }
    }
    if (!response.ok) throw new Error(`Remote upload control failed (HTTP ${response.status}).`)
    const envelope = await response.json() as { type?: string; rpcId?: string; result?: { ok?: boolean; value?: unknown; error?: { message?: string } } }
    if (envelope.type !== 'server-response' || envelope.rpcId !== rpcId || envelope.result?.ok !== true) {
      throw new Error(envelope.result?.error?.message ?? 'Remote upload requires an updated Host plugin.')
    }
    if (method === 'status') {
      const mode = (envelope.result.value as { mode?: unknown } | undefined)?.mode
      if (mode === 'local' || mode === 'remote') lastMode = mode
    }
    return envelope.result.value
  }
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), baseUrl)
    const target = new URL('api/session/uploadFileBinary', baseUrl)
    if (url.origin !== target.origin || url.pathname !== target.pathname) return original(input, init)
    const source = input instanceof Request ? input : undefined
    if ((init?.method ?? source?.method ?? 'GET').toUpperCase() !== 'POST') return original(input, init)
    const signal = AbortSignal.any([init?.signal ?? source?.signal ?? new AbortController().signal, AbortSignal.timeout(60_000)])
    const status = await control('status', {}, signal) as { mode?: string; connected?: boolean; backend?: string; target?: { deviceId: string } }
    if (status.mode === 'local') return original(input, init)
    if (status.mode !== 'remote' || !status.connected) throw new Error('Remote Host is disconnected. Reconnect before uploading a file.')
    if (status.backend !== undefined && status.backend !== 'harness' && status.backend !== 'codex') throw new Error('Remote attachment receipts require a Harness or CodeX session.')
    const sessionId = url.searchParams.get('sessionId')
    const mediaType = url.searchParams.get('mediaType')
    if (!sessionId || (mediaType !== null && !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType))) {
      throw new Error('A Session and a supported image media type, when provided, are required.')
    }
    // Read incrementally so even an unbounded stream cannot exhaust the client.
    const request = source ? new Request(source, init) : new Request(url, init)
    const reader = request.body?.getReader()
    const abortRead = () => { void reader?.cancel(signal.reason).catch(() => {}) }
    signal.addEventListener('abort', abortRead, { once: true })
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (reader !== undefined) {
        signal.throwIfAborted()
        const next = await reader.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > REMOTE_UPLOAD_MAX_BYTES) throw new Error('Remote upload exceeds the Remote transfer safety limit.')
        chunks.push(next.value)
      }
    } finally {
      signal.removeEventListener('abort', abortRead)
      await reader?.cancel().catch(() => {})
      reader?.releaseLock()
    }
    signal.throwIfAborted()
    let binary = ''
    for (const chunk of chunks) for (let i = 0; i < chunk.length; i += 0x8000) binary += String.fromCharCode(...chunk.subarray(i, i + 0x8000))
    const result = await control('plugin.route', { route: 'api/session/uploadFileBinary', targetDeviceId: status.target?.deviceId, body: {
      endpoint: mediaType === null ? 'file' : 'image', payload: { sessionId, ...(mediaType === null ? {} : { mediaType }), data: btoa(binary),
        ...(url.searchParams.has('name') ? { name: url.searchParams.get('name') } : {}) },
    } }, signal) as { status: number; json: unknown }
    return new Response(JSON.stringify(result.json), { status: result.status, headers: { 'content-type': 'application/json' } })
  }
}
