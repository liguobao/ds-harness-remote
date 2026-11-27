import type { StatusFeed } from './status-stream.js'
import { CONTROL_RPC_PREFIX } from './control-route.js'

type Fetch = typeof globalThis.fetch
/** Transport safety ceiling; the Host enforces its configured attachment limits. */
export const REMOTE_UPLOAD_MAX_BYTES = 192 * 1024 * 1024

export interface UploadService {
  post(request: { path: string; body: BodyInit; headers?: Record<string, string>; signal?: AbortSignal }): Promise<{ status: number; body: string }>
}

export function installRemoteUploadCarrier(service: UploadService,
  feed: Pick<StatusFeed<{ mode: string; controlUnavailable?: boolean }>, 'subscribe'>, original: Fetch, baseUrl: string): () => void {
  const upload = createRemoteUploadFetch(original, baseUrl)
  let previous: UploadService['post'] | undefined
  const post: UploadService['post'] = async request => {
    const response = await upload(request.path, { method: 'POST', body: request.body, headers: request.headers,
      signal: request.signal, ...(request.body instanceof ReadableStream ? { duplex: 'half' } : {}) })
    return { status: response.status, body: await response.text() }
  }
  const restore = () => {
    if (previous !== undefined && service.post === post) service.post = previous
    previous = undefined
  }
  const unsubscribe = feed.subscribe(status => {
    if (status.controlUnavailable) return
    if (status.mode === 'local') restore()
    if (status.mode === 'remote' && previous === undefined) {
      previous = service.post
      service.post = post
    }
  })
  return () => { unsubscribe(); restore() }
}

export function createRemoteUploadFetch(original: Fetch, baseUrl: string): Fetch {
  let sequence = 0
  const control = async (method: string, payload: unknown, signal: AbortSignal) => {
    const rpcId = `remote-upload-${++sequence}`
    const response = await original(new URL(`${CONTROL_RPC_PREFIX.slice(1)}/${method}`, baseUrl), {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload }), signal,
    })
    if (!response.ok) throw new Error(`Remote upload control failed (HTTP ${response.status}).`)
    const envelope = await response.json() as { type?: string; rpcId?: string; result?: { ok?: boolean; value?: unknown; error?: { message?: string } } }
    if (envelope.type !== 'server-response' || envelope.rpcId !== rpcId || envelope.result?.ok !== true) {
      throw new Error(envelope.result?.error?.message ?? 'Remote upload requires an updated Host plugin.')
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
