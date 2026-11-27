import type { HeaderList, OpenMessage } from './hostc/protocol/index.js'
import { RpcError } from './safe-error.js'

export interface DshWebBrowserAuth {
  authenticatedUrl(origin: string): string
  authorizeIndex(
    request: { headers: Record<string, string>; url: string; method: string },
    response: { writeHead(status: number, headers?: Readonly<Record<string, string>>): void; end(): void },
  ): boolean
  requestRejection(request: { headers: Record<string, string> }): number | undefined
}

export interface DshWebEntryUrlAuth {
  readonly entryUrl: URL
  admit(request: {
    headers: Record<string, string>
    method: string
    url: string
    transport: 'http'
  }): { readonly rejection?: number; readonly peer?: { readonly signal?: { readonly aborted?: boolean } } } | undefined
}

export interface DshWebContextLike {
  get?(name: string, required?: boolean): unknown
  emit?(...args: unknown[]): void
  events?: unknown
}

export type DshWebRuntime =
  | { origin: URL; auth: DshWebBrowserAuth }
  | { origin: URL; entryAuth: DshWebEntryUrlAuth; authIdentity: unknown; listenerIdentity?: unknown }
export type ResolveRuntime = () => DshWebRuntime | undefined
// Cordis returns a fresh tracing proxy on each context lookup.
const cordisOriginal = Symbol.for('cordis.original')

function originalObject(value: unknown): unknown {
  return typeof value === 'object' && value !== null ? (Reflect.get(value, cordisOriginal) ?? value) : value
}

function safeGetService(ctx: DshWebContextLike | undefined, name: string): unknown {
  if (ctx === undefined) return undefined
  try {
    return ctx.get?.(name, false)
  } catch {
    return undefined
  }
}

function isValidEntryUrl(url: URL, origin: URL): boolean {
  const tokens = url.searchParams.getAll('token')
  return url.origin === origin.origin && url.pathname === '/' && tokens.length === 1 && Boolean(tokens[0])
}

function findValidEntryUrl(entries: readonly unknown[], origin: URL): URL | undefined {
  for (const candidate of entries) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const rawUrl = (candidate as { url?: unknown }).url
    if (typeof rawUrl !== 'string') continue
    try {
      const parsed = new URL(rawUrl)
      if (isValidEntryUrl(parsed, origin)) return parsed
    } catch {}
  }
  return undefined
}

export function resolveDshWebRuntime(
  ctx: DshWebContextLike,
  rootCtx?: DshWebContextLike,
): DshWebRuntime | undefined {
  if (!safeGetService(ctx, 'webApp')) return
  const listener = safeGetService(ctx, 'webServer') as { getOrigin?(): string } | undefined
  const auth = safeGetService(ctx, 'connection') as (Partial<DshWebBrowserAuth> & { admit?: DshWebEntryUrlAuth['admit'] }) | undefined
  if (typeof listener?.getOrigin !== 'function') return
  let origin: URL
  try {
    origin = new URL(listener.getOrigin())
  } catch {
    return
  }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.href !== origin.origin + '/') return
  if (typeof auth?.authenticatedUrl === 'function'
    && typeof auth.authorizeIndex === 'function'
    && typeof auth.requestRejection === 'function') {
    return { origin, auth: auth as DshWebBrowserAuth }
  }
  const rawAuth = originalObject(auth) as { admit?: DshWebEntryUrlAuth['admit'] } | undefined
  if (typeof rawAuth?.admit !== 'function') return
  const entries: unknown[] = []
  const emitEntryUrls = (target: DshWebContextLike | undefined): void => {
    try {
      target?.emit?.(listener, 'webserver/entry-url', origin.href, entries)
    } catch {}
  }
  emitEntryUrls(ctx)
  if (entries.length === 0 && rootCtx !== undefined && rootCtx.events !== ctx.events) {
    emitEntryUrls(rootCtx)
  }
  const entryUrl = findValidEntryUrl(entries, origin)
  if (entryUrl === undefined) return
  return {
    origin,
    entryAuth: {
      entryUrl,
      admit: request => rawAuth.admit!(request),
    },
    authIdentity: rawAuth,
    listenerIdentity: originalObject(listener),
  }
}

function sameRuntime(a: DshWebRuntime, b: DshWebRuntime | undefined): boolean {
  if (b === undefined || a.origin.href !== b.origin.href) return false
  if ('auth' in a) return 'auth' in b && originalObject(a.auth) === originalObject(b.auth)
  return 'entryAuth' in b
    && originalObject(a.authIdentity) === originalObject(b.authIdentity)
    && originalObject(a.listenerIdentity) === originalObject(b.listenerIdentity)
}

export async function openDshWebUpstream(resolveRuntime: ResolveRuntime, signal: AbortSignal) {
  const runtime = resolveRuntime()
  if (!runtime) throw new RpcError('DSH_WEB_NOT_READY', 'The DSH Web GUI is unavailable.', undefined, true)
  const cookie = await browserCookie(runtime, signal)
  const local = await fetch(runtime.origin, { headers: { cookie }, redirect: 'manual', signal })
  await local.body?.cancel()
  if (!local.ok || !local.headers.get('content-type')?.startsWith('text/html'))
    throw new RpcError('DSH_WEB_NOT_READY', 'The local Web GUI did not respond.', undefined, true)
  const isCurrent = () => sameRuntime(runtime, resolveRuntime())
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

async function browserCookie(runtime: DshWebRuntime, signal: AbortSignal): Promise<string> {
  if ('auth' in runtime) return legacyBrowserCookie(runtime)
  return entryUrlBrowserCookie(runtime.origin, runtime.entryAuth, signal)
}

function legacyBrowserCookie({ origin, auth }: { origin: URL; auth: DshWebBrowserAuth }): string {
  const bootstrap = new URL(auth.authenticatedUrl(origin.href))
  let cookie: string | undefined
  auth.authorizeIndex({ method: 'GET', url: '/' + bootstrap.search, headers: { host: origin.host } }, {
    writeHead(status, headers) { if (status === 303) cookie = headers?.['set-cookie']?.split(';')[0] },
    end() {},
  })
  if (!cookie || auth.requestRejection({ headers: { host: origin.host, cookie } }) !== undefined)
    throw new RpcError('DSH_WEB_NOT_READY', 'The local Web GUI authentication is unavailable.', undefined, true)
  return cookie
}

function extractMintedCookie(headers: Headers): string | undefined {
  const setCookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : (headers.get('set-cookie') ? [headers.get('set-cookie')!] : [])
  const pairs: string[] = []
  for (const headerValue of setCookies) {
    const [pair = '', ...attrs] = headerValue.split(';')
    if (attrs.some(attr => /^\s*max-age\s*=\s*(?:0|-)/i.test(attr))) continue
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (!name || !value) continue
    pairs.push(`${name}=${value}`)
  }
  return pairs.length > 0 ? pairs.join('; ') : undefined
}

async function entryUrlBrowserCookie(origin: URL, entryAuth: DshWebEntryUrlAuth, signal: AbortSignal): Promise<string> {
  if (!isValidEntryUrl(entryAuth.entryUrl, origin)) {
    throw new RpcError('DSH_WEB_NOT_READY', 'The local Web GUI authentication is unavailable.', undefined, true)
  }
  const response = await fetch(entryAuth.entryUrl, { method: 'GET', redirect: 'manual', signal })
  const cookie = extractMintedCookie(response.headers)
  await response.body?.cancel()
  if (response.status !== 303 || cookie === undefined) {
    throw new RpcError('DSH_WEB_NOT_READY', 'The local Web GUI authentication is unavailable.', undefined, true)
  }
  let admission: ReturnType<DshWebEntryUrlAuth['admit']>
  try {
    admission = entryAuth.admit({
      headers: { host: origin.host, cookie },
      method: 'GET',
      url: origin.href,
      transport: 'http',
    })
  } catch {
    throw new RpcError('DSH_WEB_NOT_READY', 'The local Web GUI authentication is unavailable.', undefined, true)
  }
  if (admission === undefined || admission.rejection !== undefined
    || admission.peer === undefined || admission.peer.signal?.aborted === true) {
    throw new RpcError('DSH_WEB_NOT_READY', 'The local Web GUI authentication is unavailable.', undefined, true)
  }
  return cookie
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
