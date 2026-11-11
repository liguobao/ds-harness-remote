import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { registerControlRoute, type HostWebServerLike } from '../src/control-route.js'
import { createPluginRouteCatalogGuard, createPluginRouteFetch } from '../src/plugin-route-client.js'

const servers: Server[] = []
const cleanup = async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections()
    server.close(() => resolve())
  })))
}
afterEach(cleanup)

describe('browser plugin route authority', () => {
  it('tunnels the first request through the real control envelope before any UI status arrives', async () => {
    await runScenarios([
      { name: 'relative route', prefix: '', kind: 'relative' },
      { name: 'absolute same-origin URL', prefix: '', kind: 'url' },
      { name: 'Request with body override', prefix: '', kind: 'request' },
      { name: 'proxy mount prefix', prefix: '/preview', kind: 'relative' },
    ].map(row => ({
      name: row.name,
      run: async () => {
        const host = await carrier(row.prefix)
        const body = JSON.stringify({ endpoint: 'state', payload: null })
        const input = row.kind === 'url' ? new URL('api/bot', host.baseUrl)
          : row.kind === 'request' ? new Request(new URL('api/bot', host.baseUrl), { method: 'POST', body: '{}' })
          : 'api/bot'
        const response = await host.fetch(input, { method: 'POST', body })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true, value: { source: 'remote' } })
        expect(host.forward).toHaveBeenCalledWith({ route: 'api/bot', body: { endpoint: 'state', payload: null } })
        expect(host.local).not.toHaveBeenCalled()
      },
    })), cleanup)
  })

  it('reads local routes only with explicit local authority and rejects unavailable or virtual remote catalogs', async () => {
    await runScenarios([
      { name: 'explicit local mode', status: { mode: 'local' }, local: true, code: undefined },
      { name: 'disconnected Remote', status: { mode: 'remote', connected: false }, local: false, code: 'remote-plugin/disconnected' },
      { name: 'missing route capability', status: { mode: 'remote', connected: true, remoteFeatures: { pluginRoute: false } }, local: false, code: 'remote-plugin/host-unsupported' },
      ...['codex', 'cursor', 'antigravity'].map(backend => ({
        name: `${backend} catalog`, status: { ...remoteStatus(), backend }, local: false, code: 'remote-plugin/backend-unsupported',
      })),
      { name: 'unknown authority', status: {}, local: false, code: 'remote-plugin/authority-unavailable' },
    ].map(row => ({
      name: row.name,
      run: async () => {
        const host = await carrier()
        host.status = row.status
        const response = await host.fetch('api/bot', { method: 'POST', body: '{}' })
        expect(response.status).toBe(200)
        if (!row.local) expect(await response.json()).toMatchObject({ ok: false, error: { code: row.code } })
        expect(host.local).toHaveBeenCalledTimes(row.local ? 1 : 0)
        expect(host.forward).not.toHaveBeenCalled()
      },
    })), cleanup)
  })

  it('changes authority immediately and never reuses a local roster after selecting Remote', async () => {
    const host = await carrier()
    const request = () => host.fetch('api/bot', { method: 'POST', body: '{}' })
    host.status = { mode: 'local' }
    expect((await request()).status).toBe(200)
    host.status = remoteStatus()
    expect((await request()).status).toBe(200)
    host.status = { ...remoteStatus(), connected: false }
    expect(await (await request()).json()).toMatchObject({ ok: false, error: { code: 'remote-plugin/disconnected' } })
    expect(host.local).toHaveBeenCalledOnce()
    expect(host.forward).toHaveBeenCalledOnce()
  })

  it('gates remote roster publication on Session catalog readiness and preserves cancellation during the wait', async () => {
    await runScenarios([false, true].map(cancel => ({
      name: cancel ? 'cancel while catalog is loading' : 'publish only after catalog is ready',
      run: async () => {
        const host = await carrier()
        host.routeJson = { ok: true, value: { bots: [{ id: 'new-session' }] } }
        let finishCatalog!: () => void
        let catalogStarted!: () => void
        const started = new Promise<void>(resolve => { catalogStarted = resolve })
        const ready = new Promise<void>(resolve => { finishCatalog = resolve })
        let ids: string[] = []
        const refresh = vi.fn(async () => { catalogStarted(); await ready; ids = ['new-session'] })
        const beforeResponse = vi.fn(createPluginRouteCatalogGuard(async () => ({
          list: { getSnapshot: () => ({ ids, phase: 'ready' }) }, refresh,
        })))
        const original: typeof fetch = (input, init) => fetch(input instanceof Request ? input : new URL(String(input), host.baseUrl), init)
        const wrapped = createPluginRouteFetch(original, host.baseUrl, { beforeResponse })
        const controller = new AbortController()
        let published = false
        const response = wrapped('api/bot', { method: 'POST', body: JSON.stringify({ endpoint: 'state' }), signal: controller.signal })
          .then(value => { published = true; return value })
        await started
        expect(published).toBe(false)
        if (cancel) {
          controller.abort()
          try {
            await expect(response).rejects.toMatchObject({ name: 'AbortError' })
            expect(published).toBe(false)
            expect(refresh).toHaveBeenCalledOnce()
          } finally {
            finishCatalog()
          }
          return
        }
        finishCatalog()
        expect((await response).status).toBe(200)
        expect(refresh).toHaveBeenCalledOnce()
        expect(beforeResponse).toHaveBeenCalledWith(remoteStatus(), { endpoint: 'state' }, host.routeJson, expect.any(AbortSignal))
      },
    })), cleanup)
  })

  it('publishes roster Sessions only when they are present in the official catalog, including after a joined stale pull', async () => {
    await runScenarios([
      { name: 'ready catalog with missing Session after swallowed refresh failure', initial: ['old-session'], arrivesAt: 0, succeeds: false, pulls: 2 },
      { name: 'new full roster after an earlier ready catalog', initial: ['old-session'], arrivesAt: 1, succeeds: true, pulls: 1 },
      { name: 'first pull joins a baseline from before Bot creation', initial: ['old-session'], arrivesAt: 2, succeeds: true, pulls: 2 },
      { name: 'already catalogued Session', initial: ['new-session'], arrivesAt: 0, succeeds: true, pulls: 0 },
      { name: 'missing public refresh method', initial: ['old-session'], arrivesAt: 0, succeeds: false, pulls: 0, noRefresh: true },
    ].map(row => ({
      name: row.name,
      run: async () => {
        const host = await carrier()
        host.routeJson = { ok: true, value: { bots: [{ id: 'new-session' }], rooms: [], agents: [] } }
        let ids = row.initial
        let pulls = 0
        const refresh = vi.fn(async () => {
          if (++pulls === row.arrivesAt) ids = ['new-session']
        })
        const sessions = {
          list: { getSnapshot: () => ({ ids, phase: 'ready' }) },
          ...(row.noRefresh ? {} : { refresh }),
        }
        const original: typeof fetch = (input, init) => fetch(input instanceof Request ? input : new URL(String(input), host.baseUrl), init)
        const wrapped = createPluginRouteFetch(original, host.baseUrl, {
          beforeResponse: createPluginRouteCatalogGuard(async () => sessions),
        })
        const result = await (await wrapped('api/bot', { method: 'POST', body: JSON.stringify({ endpoint: 'state' }) })).json()
        if (row.succeeds) expect(result).toEqual(host.routeJson)
        else expect(result).toMatchObject({ ok: false, error: { code: 'remote-plugin/catalog-unavailable' } })
        expect(refresh).toHaveBeenCalledTimes(row.pulls)
        expect(host.local).not.toHaveBeenCalled()
      },
    })), cleanup)
  })

  it('checks Session references in each Bot response shape without treating roster Agent IDs as Sessions', async () => {
    await runScenarios([
      { endpoint: 'state', value: { bots: [{ id: 'bot', sessionId: 'current', parts: ['part'] }], rooms: [{ id: 'room', sessionId: 'room-part', ownParts: ['room-old'], parts: ['member'] }], agents: [{ id: 'agent-roster-id', sessions: ['agent-session'] }] }, ids: ['bot', 'current', 'part', 'room', 'room-part', 'room-old', 'member', 'agent-session'] },
      { endpoint: 'create-bot', value: { id: 'bot', segments: [{ sessionId: 'current' }] }, ids: ['bot', 'current'] },
      { endpoint: 'create-room', value: { id: 'room', sessionId: 'room-part', sessions: { bot: 'member' } }, ids: ['room', 'room-part', 'member'] },
      { endpoint: 'update-room', value: { room: { id: 'room', sessionId: 'room-part', ownParts: ['room-old'], parts: ['member'] } }, ids: ['room', 'room-part', 'room-old', 'member'] },
      { endpoint: 'goal-control', value: { bots: [{ id: 'bot', sessionId: 'current' }], rooms: [{ id: 'room', sessionId: 'room-part' }], agents: [] }, ids: ['bot', 'current', 'room', 'room-part'] },
      { endpoint: 'add-agent', value: { id: 'agent-roster-id', sessions: ['agent-session'] }, ids: ['agent-session'] },
      { endpoint: 'agent-session', value: { sessionId: 'agent-session' }, ids: ['agent-session'] },
      { endpoint: 'agent-adopt', value: { sessionId: 'agent-session' }, ids: ['agent-session'] },
      { endpoint: 'set-flags', value: { id: 'room', members: ['bot'], sessions: { bot: 'member' } }, ids: ['room', 'member'] },
    ].map(row => ({
      name: row.endpoint,
      run: async () => {
        let ids: string[] = []
        const refresh = vi.fn(async () => { ids = row.ids })
        const guard = createPluginRouteCatalogGuard(async () => ({ list: { getSnapshot: () => ({ ids, phase: 'ready' }) }, refresh }))
        await guard(remoteStatus(), { endpoint: row.endpoint }, { ok: true, value: row.value }, new AbortController().signal)
        expect(refresh).toHaveBeenCalledOnce()
        ids = row.ids.slice(0, -1)
        refresh.mockImplementation(async () => {})
        await expect(guard(remoteStatus(), { endpoint: row.endpoint }, { ok: true, value: row.value }, new AbortController().signal)).rejects.toThrow('does not contain')
      },
    })))
  })

  it('preserves cancellation and rejects uncorrelated control responses without reaching local routes', async () => {
    await runScenarios([
      {
        name: 'caller cancellation',
        run: async () => {
          const original = vi.fn<typeof fetch>()
          const wrapped = createPluginRouteFetch(original, 'http://127.0.0.1/')
          const controller = new AbortController()
          controller.abort()
          await expect(wrapped('api/bot', { method: 'POST', body: '{}', signal: controller.signal }))
            .rejects.toMatchObject({ name: 'AbortError' })
          expect(original).not.toHaveBeenCalled()
        },
      },
      {
        name: 'wrong RPC correlation',
        run: async () => {
          const original = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
            type: 'server-response', rpcId: 'other-request', result: { ok: true, value: remoteStatus() },
          })))
          const wrapped = createPluginRouteFetch(original, 'http://127.0.0.1/')
          const response = await wrapped('api/bot', { method: 'POST', body: '{}' })
          expect(response.status).toBe(200)
          expect(await response.json()).toMatchObject({ ok: false, error: { code: 'remote-plugin/control-invalid' } })
          expect(original).toHaveBeenCalledOnce()
        },
      },
    ], cleanup)
  })

  it('reports Host route and control refusals in the DS Bot error envelope without exposing upstream data', async () => {
    await runScenarios([
      { name: 'missing ds-bot route', status: 404, code: 'remote-plugin/bot-not-loaded' },
      { name: 'missing Host carrier', status: 503, code: 'remote-plugin/host-carrier-unavailable' },
      { name: 'unsupported Host RPC', remoteCode: 'FEATURE_NOT_SUPPORTED', code: 'remote-plugin/host-unsupported' },
      { name: 'lost Host connection', remoteCode: 'TRANSPORT_CLOSED', code: 'remote-plugin/disconnected' },
      { name: 'other control refusal', remoteCode: 'PERMISSION_DENIED', code: 'remote-plugin/control-rejected' },
      { name: 'disallowed Bot operation', remoteCode: 'INVALID_MESSAGE', code: 'remote-plugin/operation-not-allowed' },
      { name: 'catalog not ready', catalog: true, code: 'remote-plugin/catalog-unavailable' },
    ].map(row => ({
      name: row.name,
      run: async () => {
        const host = await carrier()
        host.routeStatus = row.status ?? 200
        host.rejectCode = row.remoteCode
        const original: typeof fetch = (input, init) => fetch(input instanceof Request ? input : new URL(String(input), host.baseUrl), init)
        const wrapped = createPluginRouteFetch(original, host.baseUrl, {
          beforeResponse: row.catalog ? async () => { throw new Error('private upstream data') } : undefined,
        })
        const response = await wrapped('api/bot', { method: 'POST', body: '{}' })
        expect(response.status).toBe(200)
        const result = await response.json()
        expect(result).toMatchObject({ ok: false, error: { code: row.code, message: expect.any(String) } })
        expect(JSON.stringify(result)).not.toContain('private upstream data')
        expect(host.local).not.toHaveBeenCalled()
      },
    })), cleanup)
  })
})

describe('browser plugin route failure classification', () => {
  const routeUrl = 'http://127.0.0.1/'
  // Correlate on the request's own rpcId: the probe and the route call differ.
  const envelope = (value: unknown, init?: RequestInit) => new Response(JSON.stringify({
    type: 'server-response',
    rpcId: (JSON.parse(String(init?.body)) as { rpcId: string }).rpcId,
    result: { ok: true, value },
  }))
  const controlCall = (input: RequestInfo | URL) => new URL(String(input)).pathname.endsWith('/status') ? 'status' : 'route'
  const settle = async (original: typeof fetch, body = '{}', signal?: AbortSignal) => {
    const response = await createPluginRouteFetch(original, routeUrl)('api/bot', { method: 'POST', body, signal })
    return await response.json() as { ok: boolean; error: { code: string; message: string; details: Record<string, unknown> } }
  }

  it('classifies each failure stage with its own code and details', async () => {
    await runScenarios([
      {
        name: '10s status probe timeout',
        run: async () => {
          const probe = new AbortController()
          const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(probe.signal)
          const caller = new AbortController()
          try {
            const result = await settle(vi.fn<typeof fetch>(async () => {
              probe.abort(new DOMException('The operation timed out.', 'TimeoutError'))
              throw probe.signal.reason
            }), '{}', caller.signal)
            expect(result).toMatchObject({
              ok: false,
              error: {
                code: 'remote-plugin/control-timeout',
                message: 'The local Remote control probe timed out. Reload the Remote plugin.',
                details: { stage: 'status', timeoutMs: 10_000, errorName: 'TimeoutError' },
              },
            })
          } finally {
            spy.mockRestore()
          }
        },
      },
      {
        name: 'status request network ETIMEDOUT before probe timeout',
        run: async () => {
          const timeoutErr = new Error('connect ETIMEDOUT')
          Object.assign(timeoutErr, { code: 'ETIMEDOUT' })
          const result = await settle(vi.fn<typeof fetch>(async () => {
            throw timeoutErr
          }))
          expect(result).toMatchObject({
            ok: false,
            error: {
              code: 'remote-plugin/control-timeout',
              message: 'The local Remote control request timed out. Reload the Remote plugin.',
              details: { stage: 'transport', method: 'status', errorName: 'Error' },
            },
          })
          expect(result.error.details).not.toHaveProperty('timeoutMs')
        },
      },
      {
        name: 'control transport TypeError',
        run: async () => {
          const result = await settle(vi.fn<typeof fetch>(async () => {
            throw new TypeError('fetch failed')
          }))
          expect(result).toMatchObject({
            ok: false,
            error: { code: 'remote-plugin/control-unavailable', message: 'The local Remote control request failed. Reload the Remote plugin.', details: { stage: 'transport', method: 'status', errorName: 'TypeError' } },
          })
          expect(JSON.stringify(result)).not.toContain('fetch failed')
        },
      },
      {
        name: 'control non-2xx response',
        run: async () => {
          const result = await settle(vi.fn<typeof fetch>(async () => new Response('upstream secret', { status: 502 })))
          expect(result).toMatchObject({ ok: false, error: { code: 'remote-plugin/control-unavailable', details: { stage: 'transport', httpStatus: 502 } } })
          expect(JSON.stringify(result)).not.toContain('upstream secret')
        },
      },
      {
        name: 'structurally invalid route response',
        run: async () => {
          await runScenarios([
            { label: 'null result', value: null },
            { label: 'undefined result', value: undefined },
            { label: 'string result', value: 'not-a-record' },
            { label: 'number result', value: 42 },
            { label: 'boolean result', value: true },
            { label: 'array result', value: [] },
            { label: 'missing status', value: { json: { ok: true } } },
            { label: 'non-integer status', value: { status: '200', json: { ok: true } } },
            { label: 'float status', value: { status: 200.5, json: { ok: true } } },
            { label: 'NaN status', value: { status: Number.NaN, json: { ok: true } } },
            { label: 'Infinity status', value: { status: Number.POSITIVE_INFINITY, json: { ok: true } } },
            { label: 'status below range', value: { status: 199, json: { ok: true } } },
            { label: 'status above range', value: { status: 600, json: { ok: true } } },
          ].map(row => ({
            name: row.label,
            run: async () => {
              const original = vi.fn<typeof fetch>(async (input, init) =>
                envelope(controlCall(input) === 'status' ? remoteStatus() : row.value, init))
              const result = await settle(original)
              expect(result).toMatchObject({ ok: false, error: { code: 'remote-plugin/route-response-invalid', details: { stage: 'response-structure' } } })
            },
          })))
        },
      },
      {
        name: 'request body that is not a JSON object',
        run: async () => {
          await runScenarios([
            { label: 'malformed JSON', body: 'not-json' },
            { label: 'JSON array', body: '[]' },
            { label: 'JSON scalar', body: '7' },
          ].map(row => ({
            name: row.label,
            run: async () => {
              const original = vi.fn<typeof fetch>(async (_input, init) => envelope(remoteStatus(), init))
              const result = await settle(original, row.body)
              expect(result).toMatchObject({ ok: false, error: { code: 'remote-plugin/route-request-invalid', details: { stage: 'request-body' } } })
            },
          })))
        },
      },
    ])
  })

  it('keeps caller cancellation and unexpected errors free of upstream data', async () => {
    await runScenarios([
      {
        name: 'caller abort stays an AbortError',
        run: async () => {
          const original = vi.fn<typeof fetch>(async (_input, init) => envelope(remoteStatus(), init))
          const controller = new AbortController()
          const wrapped = createPluginRouteFetch(original, routeUrl)
          const pending = wrapped('api/bot', { method: 'POST', body: '{}', signal: controller.signal })
          controller.abort()
          await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
          expect(original).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'POST', body: expect.stringContaining('plugin.route') }))
        },
      },
      {
        name: 'unexpected error keeps only its name',
        run: async () => {
          const original = vi.fn<typeof fetch>(async () => ({
            ok: true,
            json: async () => { throw new RangeError('private upstream data') },
          }) as unknown as Response)
          const result = await settle(original)
          expect(result).toMatchObject({ ok: false, error: { code: 'remote-plugin/unavailable', details: { errorName: 'RangeError' } } })
          expect(JSON.stringify(result)).not.toContain('private upstream data')
        },
      },
      {
        name: 'error with custom/tampered name normalizes to Error without leaking upstream data',
        run: async () => {
          const tamperedError = new Error('private upstream data')
          tamperedError.name = 'private upstream data'
          const original = vi.fn<typeof fetch>(async () => ({
            ok: true,
            json: async () => { throw tamperedError },
          }) as unknown as Response)
          const result = await settle(original)
          expect(result).toMatchObject({
            ok: false,
            error: {
              code: 'remote-plugin/unavailable',
              details: { errorName: 'Error' },
            },
          })
          expect(result.error.details.errorName).toBe('Error')
          expect(JSON.stringify(result)).not.toContain('private upstream data')
        },
      },
      {
        name: 'timeout that escapes the probe still reads as a timeout',
        run: async () => {
          const original = vi.fn<typeof fetch>(async (input, init) => {
            if (controlCall(input) === 'status') return envelope(remoteStatus(), init)
            throw new DOMException('The operation timed out.', 'TimeoutError')
          })
          const result = await settle(original)
          expect(result).toMatchObject({
            ok: false,
            error: {
              code: 'remote-plugin/control-timeout',
              message: 'The Remote plugin route request timed out. Reload the Remote plugin.',
              details: { stage: 'route', errorName: 'TimeoutError' },
            },
          })
        },
      },
    ])
  })
})

function remoteStatus(): Record<string, unknown> {
  return { mode: 'remote', connected: true, backend: 'harness', remoteFeatures: { pluginRoute: true } }
}

async function carrier(prefix = '') {
  const routes: Parameters<HostWebServerLike['register']>[0][] = []
  const host = {
    status: remoteStatus(),
    local: vi.fn(),
    forward: vi.fn(),
    baseUrl: '',
    fetch: undefined as unknown as typeof fetch,
    routeStatus: 200,
    rejectCode: undefined as string | undefined,
    routeJson: { ok: true, value: { source: 'remote' } } as unknown,
  }
  registerControlRoute({ requestRejection: () => undefined, rpc: { handle: () => { throw new Error('Unexpected fallback') } } },
    async (endpoint, payload) => {
      if (endpoint === 'status') return { ok: true, value: host.status }
      expect(endpoint).toBe('plugin.route')
      host.forward(payload)
      if (host.rejectCode !== undefined) return { ok: false, error: { code: 'internal', message: 'private upstream data', details: { remoteCode: host.rejectCode } } }
      return { ok: true, value: { status: host.routeStatus, json: host.routeJson } }
    }, { register: route => { routes.push(route); return () => undefined } })
  const server = createServer((request, response) => {
    request.url = request.url?.slice(prefix.length)
    const route = routes.find(route => request.url?.startsWith(`${route.path}/`))
    if (route !== undefined) { void route.handler(request, response); return }
    host.local()
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, value: { source: 'local' } }))
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  host.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}${prefix}/`
  const original: typeof fetch = (input, init) => fetch(input instanceof Request ? input : new URL(String(input), host.baseUrl), init)
  host.fetch = createPluginRouteFetch(original, host.baseUrl)
  return host
}
