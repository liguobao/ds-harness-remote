import type { HeaderList, OpenMessage } from './hostc/protocol/index.js'
import { RpcError } from './safe-error.js'

export interface DshWebBrowserAuth {
  authenticatedUrl(origin: string): string
  authorizeIndex(
    request: { headers: Record<string, string>; url: string; method: string },
    response: { writeHead(status: number, headers?: Readonly<Record<string, string>>): void; end(): void },
  ): boolean
  requestRejection?(request: { headers: Record<string, string> }): number | undefined
  admit?(request: { headers: Record<string, string> }): { rejection?: number; peer?: unknown } | undefined
}

export type DshWebRuntime = { origin: URL; auth: DshWebBrowserAuth }
export type ResolveRuntime = () => DshWebRuntime | undefined
// Cordis returns a fresh tracing proxy on each context lookup.
const cordisOriginal = Symbol.for('cordis.original')

function originalAuth(auth: DshWebBrowserAuth): unknown {
  return Reflect.get(auth, cordisOriginal) ?? auth
}

export async function openDshWebUpstream(resolveRuntime: ResolveRuntime, signal: AbortSignal) {
  const runtime = resolveRuntime()
  if (!runtime) throw new RpcError('DSH_WEB_NOT_READY', 'The DSH Web GUI is unavailable.', undefined, true)
  const authInstance = originalAuth(runtime.auth)
  const cookie = browserCookie(runtime)
  const local = await fetch(runtime.origin, { headers: { cookie }, redirect: 'manual', signal })
  await local.body?.cancel()
  if (!local.ok || !local.headers.get('content-type')?.startsWith('text/html'))
    throw new RpcError('DSH_WEB_NOT_READY', 'The local Web GUI did not respond.', undefined, true)
  const isCurrent = () => {
    const current = resolveRuntime()
    return current?.origin.href === runtime.origin.href && originalAuth(current.auth) === authInstance
  }
  return {
    target: runtime.origin,
    isCurrent,
    authorize(request: OpenMessage, browserOrigin: URL) {
      if (!isCurrent()) return
      return authorizeUpstream(request, browserOrigin, cookie)
    },
    stripResponseHeaders,
  }
}

function browserCookie({ origin, auth }: DshWebRuntime): string {
  const bootstrap = new URL(auth.authenticatedUrl(origin.href))
  let cookie: string | undefined
  auth.authorizeIndex({ method: 'GET', url: '/' + bootstrap.search, headers: { host: origin.host } }, {
    writeHead(status, headers) { if (status === 303) cookie = headers?.['set-cookie']?.split(';')[0] },
    end() {},
  })
  if (!cookie || !isLocalCookieAuthorized(auth, { headers: { host: origin.host, cookie } }))
    throw new RpcError('DSH_WEB_NOT_READY', 'The local Web GUI authentication is unavailable.', undefined, true)
  return cookie
}

function isLocalCookieAuthorized(auth: DshWebBrowserAuth, request: { headers: Record<string, string> }): boolean {
  if (typeof auth.requestRejection === 'function') {
    try {
      return auth.requestRejection(request) === undefined
    } catch {
      return false
    }
  }
  if (typeof auth.admit === 'function') {
    let admission: { rejection?: number; peer?: unknown } | undefined
    try {
      admission = auth.admit(request)
    } catch {
      return false
    }
    if (typeof admission !== 'object' || admission === null) return false
    if (typeof admission.rejection === 'number') return false
    return isOwnerPeer(admission.peer)
  }
  return false
}

function isOwnerPeer(peer: unknown): boolean {
  if (typeof peer !== 'object' || peer === null) return false
  const candidate = peer as { readonly principal?: { readonly kind?: unknown } | string; readonly signal?: { readonly aborted?: boolean } }
  if (candidate.signal?.aborted === true) return false
  const principal = candidate.principal
  if (typeof principal === 'string') return principal === 'owner'
  if (typeof principal === 'object' && principal !== null) return principal.kind === 'owner'
  return false
}

export function authorizeUpstream(request: OpenMessage, publicUrl: URL, cookie: string): OpenMessage | undefined {
  let path: string
  try { path = decodeURIComponent(request.path.split('?')[0] ?? '') } catch { return }
  if (!path.startsWith('/') || path.startsWith('//') || /[%\\\u0000-\u0020\u007f?#]/.test(path)
    || path.split('/').some(segment => segment === '.' || segment === '..')
    || /^\/(ds-harness-remote|__remote|connect)(\/|$)/i.test(path)
    || new URL(request.path, publicUrl).searchParams.has('token')
    || !/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(request.method)) return
  const headers: HeaderList = []
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase()
    if (lower === 'origin' && value !== publicUrl.origin) return
    if (lower === 'sec-fetch-site' && value === 'cross-site') return
    if (lower === 'cookie' || lower === 'authorization' || lower === 'forwarded' || lower.startsWith('x-forwarded-')) continue
    headers.push([name, value])
  }
  headers.push(['cookie', cookie])
  return { ...request, headers }
}

function stripResponseHeaders(headers: HeaderList): HeaderList {
  return headers.filter(([name, value]) => name.toLowerCase() !== 'set-cookie'
    && !(name.toLowerCase() === 'location' && /[?&]token=/i.test(value)))
}
