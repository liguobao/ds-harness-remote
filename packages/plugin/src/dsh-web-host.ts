import { randomUUID } from 'node:crypto'
import { dshWebGrantSchema, type DshWebGrant } from '@dsh-remote/protocol'
import { z } from 'zod'
import { Connection } from './hostc/connection.js'
import { CLOSE_REPLACED, CLOSE_SHUTDOWN, type HeaderList, type OpenMessage } from './hostc/protocol/index.js'
import { RpcError } from './safe-error.js'
import { ServerApiError, type DshWebRequest, type HostServerApi } from './server-api.js'

export interface DshWebBrowserAuth {
  authenticatedUrl(origin: string): string
  authorizeIndex(
    request: { headers: Record<string, string>; url: string; method: string },
    response: { writeHead(status: number, headers?: Readonly<Record<string, string>>): void; end(): void },
  ): boolean
  requestRejection(request: { headers: Record<string, string> }): number | undefined
}

export type DshWebRuntime = { origin: URL; auth: DshWebBrowserAuth }
type ResolveRuntime = () => DshWebRuntime | undefined
type Peer = Pick<DshWebRequest, 'clientDeviceId' | 'connectionId'>

const allocationSchema = z.object({
  sessionId: z.string().regex(/^[pt][abcdefghijkmnpqrstuvwxyz23456789]{11}$/),
  url: z.url(),
  connectUrl: z.url(),
  connectToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  leaseExpiresAt: z.number().int().positive(),
}).strict()

interface Lease {
  readonly id: string
  readonly request: DshWebRequest
  readonly stop: AbortController
  connector?: Connection
}

export class DshWebPeer {
  private active?: Lease
  private opening?: Promise<DshWebGrant>
  private openingStop?: AbortController
  private readonly lifetime = new AbortController()

  constructor(private readonly api: HostServerApi, private readonly peer: Peer, private readonly resolveRuntime: ResolveRuntime) {}

  available(): boolean {
    try { return this.resolveRuntime() !== undefined } catch { return false }
  }

  open(): Promise<DshWebGrant> {
    if (this.opening) return this.opening
    this.openingStop = new AbortController()
    this.opening = this.start(this.openingStop.signal).finally(() => {
      this.opening = undefined
      this.openingStop = undefined
    })
    return this.opening
  }

  async close(): Promise<void> {
    this.openingStop?.abort()
    await this.closeActive()
  }

  private async closeActive(): Promise<void> {
    const active = this.active
    this.active = undefined
    if (active === undefined) return
    active.stop.abort()
    active.connector?.close(CLOSE_SHUTDOWN, 'session closed')
    await this.api.closeDshWeb(active.id).catch(() => undefined)
  }

  async dispose(): Promise<void> {
    this.lifetime.abort()
    await this.close()
    await this.opening?.catch(() => undefined)
  }

  private async start(openingSignal: AbortSignal): Promise<DshWebGrant> {
    await this.closeActive()
    const signal = AbortSignal.any([this.lifetime.signal, openingSignal, AbortSignal.timeout(21_000)])
    const input = { ...this.peer, requestId: randomUUID(), leaseExpiresAt: Date.now() + 9 * 60_000 }
    try {
      signal.throwIfAborted()
      const runtime = this.resolveRuntime()
      if (runtime === undefined) throw new RpcError('DSH_WEB_NOT_READY', 'The DSH Web GUI is unavailable.', undefined, true)
      const cookie = browserCookie(runtime)
      const local = await fetch(runtime.origin, { headers: { cookie }, redirect: 'manual', signal })
      await local.body?.cancel()
      if (!local.ok || !local.headers.get('content-type')?.startsWith('text/html'))
        throw new RpcError('DSH_WEB_NOT_READY', 'The local Web GUI did not respond.', undefined, true)
      const allocation = allocationSchema.parse(await this.api.dshWebRequest('allocate', input, signal))
      const publicUrl = new URL(allocation.url)
      const dial = new URL(allocation.connectUrl)
      const lease: Lease = { id: allocation.sessionId, stop: new AbortController(), request: { ...input, leaseExpiresAt: allocation.leaseExpiresAt } }
      this.active = lease
      if (dial.protocol !== 'wss:' || dial.port || dial.href !== `wss://${dial.hostname}/api/tunnels/${lease.id}/connect`
        || publicUrl.href !== `https://${lease.id}.${dial.hostname}/`
        || lease.request.leaseExpiresAt <= Date.now() || lease.request.leaseExpiresAt > input.leaseExpiresAt) {
        throw new RpcError('TUNNEL_UNAVAILABLE', 'The Server returned an invalid tunnel.')
      }
      const listenSignal = AbortSignal.any([signal, lease.stop.signal])
      const connect = () => Connection.open({
        tunnel: { id: lease.id, url: publicUrl.href, connectUrl: dial.href, token: allocation.connectToken },
        target: runtime.origin,
        authorize: request => {
          if (lease.stop.signal.aborted || Date.now() >= lease.request.leaseExpiresAt) return
          const current = this.resolveRuntime()
          if (current?.origin.href !== runtime.origin.href || current.auth !== runtime.auth) return
          return authorizeUpstream(request, publicUrl, cookie)
        },
        stripResponseHeaders,
        onRequest: () => undefined,
      })
      await attachConnector(lease, connect, listenSignal)
      const result = dshWebGrantSchema.parse(await this.api.dshWebRequest('grant', lease.request, listenSignal))
      if (result.url !== publicUrl.href || result.expiresAt <= Date.now() || result.expiresAt > lease.request.leaseExpiresAt)
        throw new RpcError('TUNNEL_UNAVAILABLE', 'The Server returned an invalid browser grant.')
      void this.monitor(lease, connect)
      return result
    } catch (error) {
      await this.closeActive()
      if (error instanceof RpcError) throw error
      if (error instanceof ServerApiError && ['WEB_ENTITLEMENT_REQUIRED', 'MEMBERSHIP_REQUIRED', 'CONNECTION_NOT_FOUND'].includes(error.code))
        throw new RpcError(error.code, 'The Server did not authorize DSH Web access.')
      throw new RpcError('TUNNEL_UNAVAILABLE', 'The DSH Web tunnel could not be opened.', undefined, true)
    }
  }

  private async monitor(lease: Lease, connect: () => Promise<Connection>): Promise<void> {
    const timer = setTimeout(() => { if (this.active === lease) void this.close() }, Math.max(0, lease.request.leaseExpiresAt - Date.now()))
    timer.unref()
    try {
      while (this.active === lease && lease.connector) {
        const closed = await waitForCheck(lease.connector, lease.stop.signal)
        if (this.active !== lease) return
        if (closed?.code === CLOSE_REPLACED || closed?.code === CLOSE_SHUTDOWN) break
        await this.api.dshWebRequest('check', lease.request, lease.stop.signal, lease.id)
        if (closed) {
          await attachConnector(lease, connect, lease.stop.signal)
        }
      }
    } catch { /* Authorization or reconnect failed. Close the lease. */ }
    finally {
      clearTimeout(timer)
      if (this.active === lease) await this.close()
    }
  }
}

async function attachConnector(lease: Lease, dial: () => Promise<Connection>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const connector = await dial()
  if (signal.aborted) {
    connector.close(CLOSE_SHUTDOWN, 'session closed')
    signal.throwIfAborted()
  }
  lease.connector = connector
}

async function waitForCheck(connector: Connection, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    return await Promise.race([connector.closed, new Promise<undefined>(resolve => {
      onAbort = () => resolve(undefined)
      signal.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(onAbort, 15_000)
      timer.unref()
    })])
  } finally {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

function browserCookie({ origin, auth }: DshWebRuntime): string {
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
