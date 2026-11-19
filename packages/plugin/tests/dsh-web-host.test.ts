import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorizeUpstream, DshWebPeer, type DshWebBrowserAuth } from '../src/dsh-web-host.js'
import { Connection } from '../src/hostc/connection.js'
import { TunnelError } from '../src/hostc/api.js'
import type { OpenMessage } from '../src/hostc/protocol/index.js'

describe('DSH Web Host forwarding boundary', () => {
  const url = new URL('https://test.hostc.4ba.io/')
  const request: OpenMessage = { method: 'GET', path: '/api/web', headers: [], body: false }

  it.each(['/ds-harness-remote/api', '/%64s-harness-remote/api', '/%252e%252e/',
    '/api/../connect', '/connect', '/%2Fother.test/', '/?%74oken=bad'])('rejects sensitive target %s', path => {
    expect(authorizeUpstream({ ...request, path }, url, 'local=owned')).toBeUndefined()
  })

  it('replaces caller credentials and preserves an exact public Origin for normalization', () => {
    expect(authorizeUpstream({ ...request, headers: [
      ['cookie', 'fake=grant'], ['authorization', 'Bearer visitor'], ['x-forwarded-host', 'other.test'],
      ['origin', url.origin],
    ] }, url, 'local=owned')?.headers).toEqual([['origin', url.origin], ['cookie', 'local=owned']])
    expect(authorizeUpstream({ ...request, headers: [['origin', url.origin + '.other.test']] }, url, 'local=owned')).toBeUndefined()
  })
})


describe('DSH Web connector establishment', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(['network_error', 'unauthorized'] as const)('handles initial %s without reallocating', async code => {
    const id = 'tbcdefghijkm'
    const url = `https://${id}.hostc.4ba.io/`
    const leaseExpiresAt = Date.now() + 60_000
    const grant = { url, browserGrant: 'b'.repeat(43), expiresAt: Date.now() + 30_000 }
    const api = {
      dshWebRequest: vi.fn(async (action: string) => action === 'allocate' ? {
        sessionId: id, url, connectUrl: `wss://hostc.4ba.io/api/tunnels/${id}/connect`,
        connectToken: 't'.repeat(43), leaseExpiresAt,
      } : grant),
      closeDshWeb: vi.fn(async () => undefined),
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })))
    const connector = Object.assign(Object.create(Connection.prototype), {
      closed: new Promise(() => undefined),
      close: vi.fn(),
    })
    const dial = vi.spyOn(Connection, 'open').mockRejectedValueOnce(new TunnelError(code, 'synthetic failure')).mockResolvedValue(connector)
    const cordisOriginal = Symbol.for('cordis.original')
    let authInstance: DshWebBrowserAuth = {
      authenticatedUrl: origin => origin + '?token=local',
      authorizeIndex: (_request, response) => {
        response.writeHead(303, { 'set-cookie': 'local=session; Path=/' })
        return false
      },
      requestRejection: () => undefined,
    }
    const host = new DshWebPeer(api, { clientDeviceId: 'client', connectionId: 'connection' }, () => ({
      origin: new URL('http://127.0.0.1:3080/'),
      auth: new Proxy(authInstance, {
        get: (target, property, receiver) => property === cordisOriginal ? target : Reflect.get(target, property, receiver),
      }),
    }))
    try {
      if (code === 'network_error') {
        await expect(host.open()).resolves.toEqual(grant)
        expect(dial).toHaveBeenCalledTimes(2)
        expect(dial.mock.calls[0]?.[0].tunnel).toEqual(dial.mock.calls[1]?.[0].tunnel)
        expect(api.dshWebRequest.mock.calls.map(([action]) => action)).toEqual(['allocate', 'grant'])
        const authorize = dial.mock.calls[1]![0].authorize
        const index: OpenMessage = { method: 'GET', path: '/', headers: [], body: false }
        expect(authorize(index)?.headers).toEqual([['cookie', 'local=session']])
        authInstance = { ...authInstance }
        expect(authorize(index)).toBeUndefined()
      } else {
        await expect(host.open()).rejects.toMatchObject({ code: 'TUNNEL_UNAVAILABLE' })
        expect(dial).toHaveBeenCalledTimes(1)
        expect(api.dshWebRequest.mock.calls.map(([action]) => action)).toEqual(['allocate'])
      }
    } finally {
      await host.dispose()
    }
    expect(api.closeDshWeb).toHaveBeenCalledWith(id)
  })
})
