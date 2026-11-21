import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import {
  ATTENTION_SIGNAL_CAPABILITY,
  acceptNegotiatedCapabilities,
  createControlFrame,
  type AttentionDigest,
} from '@dsh-remote/protocol'
import { generateKeyPair } from '../../../packages/crypto/src/index.js'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { AttentionWebhookDispatcher } from '../src/attention-webhook.js'
import { Logger, type LogEntry } from '../src/logger.js'
import { createRemoteServer, parseAttentionWebhookUrl, type Config } from '../src/server.js'

const account = 'owner@example.com'
const password = 'local-test-password'
const legacyCapabilities = ['transport.lan', 'transport.p2p', 'transport.relay']
const attentionCapabilities = [...legacyCapabilities, ATTENTION_SIGNAL_CAPABILITY]
const validToken = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

function makeDigest(overrides: Partial<AttentionDigest> = {}): AttentionDigest {
  return {
    revision: 1,
    pendingApprovals: 1,
    pendingQuestions: 0,
    runningSessions: 1,
    completedUnread: 0,
    urgentKind: 'approval_needed',
    urgency: 'critical',
    attentionToken: validToken,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

interface WireFrame {
  type: string
  payload: Record<string, unknown>
}

interface DeviceApiItem {
  deviceId: string
  online?: boolean
  attentionDigest?: AttentionDigest
}

interface DeviceListResponse {
  items: DeviceApiItem[]
}

interface PresenceResponse {
  deviceId: string
  online: boolean
  attentionDigest?: AttentionDigest
}

interface LoginResponse {
  token: string
}

interface RegisterResponse {
  accessToken: string
  refreshToken: string
}

interface HelloAckPayload {
  capabilities: string[]
}

class Wire {
  readonly messages: WireFrame[] = []
  private readonly waiters: Array<() => void> = []

  constructor(readonly ws: WebSocket) {
    ws.on('message', raw => {
      this.messages.push(JSON.parse(raw.toString()) as WireFrame)
      for (const notify of this.waiters.splice(0)) notify()
    })
  }

  send(type: Parameters<typeof createControlFrame>[0], payload: unknown): void {
    this.ws.send(JSON.stringify(createControlFrame(type, payload)))
  }

  sendRaw(frame: unknown): void {
    this.ws.send(JSON.stringify(frame))
  }

  async next<T = Record<string, unknown>>(type: string, timeoutMs = 3000): Promise<T> {
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      const idx = this.messages.findIndex(message => message.type === type)
      if (idx >= 0) return this.messages.splice(idx, 1)[0]!.payload as T
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 25)
        this.waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    throw new Error(`Missing frame ${type}`)
  }

  async roundTripPing(nonce = randomUUID()): Promise<void> {
    this.send('ping', { nonce })
    const pong = await this.next<{ nonce: string }>('pong')
    expect(pong.nonce).toBe(nonce)
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 15))
  }
  throw new Error('Timed out waiting for condition')
}

describe('attention.signal.v1 and blind webhook', () => {
  let dir: string
  let app: ReturnType<typeof createRemoteServer> | undefined
  let base: string
  let accountToken: string
  const sockets: WebSocket[] = []
  const extraServers: HttpServer[] = []
  const dispatchers: AttentionWebhookDispatcher[] = []

  async function api<T = Record<string, unknown>>(
    path: string,
    method = 'GET',
    body?: unknown,
    token?: string,
  ): Promise<{ status: number; data: T }> {
    const response = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, data: await response.json() as T }
  }

  async function startServer(overrides: Partial<Config> = {}): Promise<void> {
    if (app) {
      await app.close()
      app = undefined
    }
    app = createRemoteServer({
      account,
      password,
      dataFile: join(dir, 'state.json'),
      publicUrl: 'http://localhost:8080',
      logLevel: 'silent',
      ...overrides,
    })
    app.server.listen(0, '127.0.0.1')
    await once(app.server, 'listening')
    base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`
    const login = await api<LoginResponse>('/auth/login', 'POST', { email: account, password })
    expect(login.status).toBe(200)
    accountToken = login.data.token
  }

  async function registerDevice(role: 'host' | 'client', name = `test-${role}`) {
    const keys = generateKeyPair()
    const descriptor = {
      deviceId: randomUUID(),
      identityKey: keys.publicKey,
      name,
      role,
      platform: 'linux',
      clientVersion: '0.5.21',
    }
    const result = await api<RegisterResponse>('/devices/register', 'POST', { v: 1, device: descriptor }, accountToken)
    expect(result.status).toBe(200)
    return { ...descriptor, keys, ...result.data }
  }

  async function connectPeer(
    device: Awaited<ReturnType<typeof registerDevice>>,
    capabilities: string[] = attentionCapabilities,
  ): Promise<{ wire: Wire; ack: HelloAckPayload }> {
    const ws = new WebSocket(`${base.replace('http:', 'ws:')}/ws/v1/connect`)
    sockets.push(ws)
    const wire = new Wire(ws)
    await once(ws, 'open')
    wire.send('hello', {
      role: device.role,
      deviceId: device.deviceId,
      accessToken: device.accessToken,
      protocols: [1],
      capabilities,
      clientVersion: device.clientVersion,
    })
    const ack = await wire.next<HelloAckPayload>('hello.ack')
    return { wire, ack }
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-server-attention-'))
    await startServer()
  })

  afterEach(async () => {
    for (const dispatcher of dispatchers.splice(0)) dispatcher.close()
    for (const ws of sockets.splice(0)) ws.terminate()
    for (const server of extraServers.splice(0)) {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
    if (app) {
      await app.close()
      app = undefined
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('negotiates attention.signal.v1 strictly as a subset of offered capabilities', async () => {
    const legacyHost = await registerDevice('host', 'legacy-host')
    const modernHost = await registerDevice('host', 'modern-host')

    const { ack: legacyAck } = await connectPeer(legacyHost, legacyCapabilities)
    expect(acceptNegotiatedCapabilities(legacyCapabilities, legacyAck.capabilities)).toEqual(legacyAck.capabilities)
    expect(legacyAck.capabilities).not.toContain(ATTENTION_SIGNAL_CAPABILITY)
    expect(legacyAck.capabilities).toEqual(expect.arrayContaining(['transport.lan', 'transport.p2p', 'transport.relay']))

    const { ack: modernAck } = await connectPeer(modernHost, attentionCapabilities)
    expect(acceptNegotiatedCapabilities(attentionCapabilities, modernAck.capabilities)).toEqual(modernAck.capabilities)
    expect(modernAck.capabilities).toContain(ATTENTION_SIGNAL_CAPABILITY)
  })

  it('propagates accepted host.attention.signal to devices, device detail, presence, and account devices', async () => {
    const host = await registerDevice('host', 'workstation')
    const client = await registerDevice('client', 'phone')
    const { wire: hostWire } = await connectPeer(host, attentionCapabilities)

    // Before any signal, attentionDigest is omitted from all REST responses.
    const beforeList = await api<DeviceListResponse>('/devices', 'GET', undefined, client.accessToken)
    expect(beforeList.status).toBe(200)
    expect('attentionDigest' in beforeList.data.items[0]!).toBe(false)

    const beforePresence = await api<PresenceResponse>(`/devices/${host.deviceId}/presence`, 'GET', undefined, client.accessToken)
    expect(beforePresence.status).toBe(200)
    expect(beforePresence.data.online).toBe(true)
    expect('attentionDigest' in beforePresence.data).toBe(false)

    const digest = makeDigest({
      revision: 1,
      pendingApprovals: 2,
      pendingQuestions: 1,
      runningSessions: 3,
      completedUnread: 1,
      urgentKind: 'approval_needed',
      urgency: 'critical',
    })
    hostWire.send('host.attention.signal', { digest })
    await hostWire.roundTripPing()

    expect(app!.gateway.attentionDigest(host.deviceId)).toEqual(digest)

    const devicesRes = await api<DeviceListResponse>('/devices', 'GET', undefined, client.accessToken)
    expect(devicesRes.status).toBe(200)
    expect(devicesRes.data.items[0]!.attentionDigest).toEqual(digest)

    const detailRes = await api<DeviceApiItem>(`/devices/${host.deviceId}`, 'GET', undefined, client.accessToken)
    expect(detailRes.status).toBe(200)
    expect(detailRes.data.attentionDigest).toEqual(digest)

    const presenceRes = await api<PresenceResponse>(`/devices/${host.deviceId}/presence`, 'GET', undefined, client.accessToken)
    expect(presenceRes.status).toBe(200)
    expect(presenceRes.data).toMatchObject({
      deviceId: host.deviceId,
      online: true,
      attentionDigest: digest,
    })

    const accountRes = await api<DeviceListResponse>('/account/devices', 'GET', undefined, accountToken)
    expect(accountRes.status).toBe(200)
    const hostEntry = accountRes.data.items.find(item => item.deviceId === host.deviceId)
    expect(hostEntry?.attentionDigest).toEqual(digest)
  })

  it('enforces monotonic revisions within a session and resets floor on reconnect', async () => {
    const host = await registerDevice('host', 'dev-box')
    const { wire: firstWire } = await connectPeer(host, attentionCapabilities)

    const rev5 = makeDigest({ revision: 5, pendingApprovals: 1, urgency: 'critical', urgentKind: 'approval_needed' })
    const staleRev3 = makeDigest({ revision: 3, pendingApprovals: 9, urgency: 'critical', urgentKind: 'approval_needed' })
    const dupRev5 = makeDigest({ revision: 5, pendingApprovals: 8, urgency: 'critical', urgentKind: 'approval_needed' })
    const rev6 = makeDigest({ revision: 6, pendingApprovals: 0, urgentKind: 'clear', urgency: 'silent' })

    firstWire.send('host.attention.signal', { digest: rev5 })
    firstWire.send('host.attention.signal', { digest: staleRev3 })
    firstWire.send('host.attention.signal', { digest: dupRev5 })
    await firstWire.roundTripPing()
    expect(app!.gateway.attentionDigest(host.deviceId)).toEqual(rev5)

    firstWire.send('host.attention.signal', { digest: rev6 })
    await firstWire.roundTripPing()
    expect(app!.gateway.attentionDigest(host.deviceId)).toEqual(rev6)

    // Reconnect replaces the existing Host WS, immediately clearing old digest and resetting revision floor.
    const firstClosed = once(firstWire.ws, 'close')
    const { wire: secondWire } = await connectPeer(host, attentionCapabilities)
    await firstClosed
    expect(app!.gateway.attentionDigest(host.deviceId)).toBeUndefined()

    const restartedRev1 = makeDigest({ revision: 1, pendingApprovals: 1, urgency: 'normal', urgentKind: 'question_needed' })
    secondWire.send('host.attention.signal', { digest: restartedRev1 })
    await secondWire.roundTripPing()
    expect(app!.gateway.attentionDigest(host.deviceId)).toEqual(restartedRev1)
  })

  it('immediately clears attentionDigest on WS close and device revocation', async () => {
    const client = await registerDevice('client', 'mobile')

    // Case 1: WS close
    const host1 = await registerDevice('host', 'host-close')
    const { wire: wire1 } = await connectPeer(host1, attentionCapabilities)
    wire1.send('host.attention.signal', { digest: makeDigest({ revision: 1 }) })
    await wire1.roundTripPing()
    expect(app!.gateway.attentionDigest(host1.deviceId)).toBeDefined()

    const closed1 = once(wire1.ws, 'close')
    wire1.ws.close()
    await closed1
    await waitFor(() => !app!.gateway.peers.has(host1.deviceId))

    expect(app!.gateway.attentionDigest(host1.deviceId)).toBeUndefined()
    const presence1 = await api<PresenceResponse>(`/devices/${host1.deviceId}/presence`, 'GET', undefined, client.accessToken)
    expect(presence1.status).toBe(200)
    expect(presence1.data.online).toBe(false)
    expect('attentionDigest' in presence1.data).toBe(false)

    // Case 2: Device revocation (store.onInvalidate -> gateway.disconnect)
    const host2 = await registerDevice('host', 'host-revoke')
    const { wire: wire2 } = await connectPeer(host2, attentionCapabilities)
    wire2.send('host.attention.signal', { digest: makeDigest({ revision: 1 }) })
    await wire2.roundTripPing()
    expect(app!.gateway.attentionDigest(host2.deviceId)).toBeDefined()

    const closed2 = once(wire2.ws, 'close')
    const revokeRes = await api('/devices/self', 'DELETE', undefined, host2.accessToken)
    expect(revokeRes.status).toBe(200)
    await closed2
    expect(app!.gateway.attentionDigest(host2.deviceId)).toBeUndefined()
  })

  it('keeps cached digest fresh while silently throttling downstream fan-out bursts > 5 and allowing critical/clear', async () => {
    const hookRevisions: number[] = []
    const webhookServer = createHttpServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { digest: { revision: number } }
        hookRevisions.push(parsed.digest.revision)
        res.writeHead(204)
        res.end()
      })
    })
    extraServers.push(webhookServer)
    webhookServer.listen(0, '127.0.0.1')
    await once(webhookServer, 'listening')
    const hookPort = (webhookServer.address() as { port: number }).port

    await startServer({ attentionWebhookUrl: `http://127.0.0.1:${hookPort}/hook` })
    const host = await registerDevice('host', 'burst-host')
    const client = await registerDevice('client', 'burst-client')
    const { wire } = await connectPeer(host, attentionCapabilities)

    // Send 9 normal signals in one tight burst:
    // - Cached digest always advances through revision 9 so REST/presence never go stale.
    // - Token bucket (burst=5) forwards only revisions <= 5 to downstream webhook and
    //   silently throttles 6..9 without tearing down the Host Control WS.
    for (let revision = 1; revision <= 9; revision += 1) {
      wire.send('host.attention.signal', {
        digest: makeDigest({
          revision,
          pendingApprovals: 0,
          completedUnread: revision,
          urgentKind: 'turn_completed',
          urgency: 'normal',
        }),
      })
    }
    await wire.roundTripPing()
    await waitFor(() => hookRevisions.length >= 1)
    await new Promise(resolve => setTimeout(resolve, 60))

    // Host WS MUST remain open with zero error frames, and cached digest MUST be fresh (rev 9).
    expect(wire.ws.readyState).toBe(WebSocket.OPEN)
    expect(wire.messages.filter(message => message.type === 'error')).toEqual([])
    expect(app!.gateway.attentionDigest(host.deviceId)?.revision).toBe(9)
    const presenceRes = await api<PresenceResponse>(`/devices/${host.deviceId}/presence`, 'GET', undefined, client.accessToken)
    expect(presenceRes.status).toBe(200)
    expect(presenceRes.data.attentionDigest?.revision).toBe(9)
    expect(hookRevisions.every(revision => revision <= 5)).toBe(true)

    // Priority signals (urgency === 'critical' and urgentKind === 'clear') bypass token bucket.
    const criticalDigest = makeDigest({
      revision: 10,
      pendingApprovals: 1,
      urgentKind: 'approval_needed',
      urgency: 'critical',
    })
    wire.send('host.attention.signal', { digest: criticalDigest })
    await wire.roundTripPing()
    await waitFor(() => hookRevisions.includes(10))
    expect(app!.gateway.attentionDigest(host.deviceId)).toEqual(criticalDigest)

    const clearDigest = makeDigest({
      revision: 11,
      pendingApprovals: 0,
      pendingQuestions: 0,
      runningSessions: 0,
      completedUnread: 0,
      urgentKind: 'clear',
      urgency: 'silent',
    })
    wire.send('host.attention.signal', { digest: clearDigest })
    await wire.roundTripPing()
    await waitFor(() => hookRevisions.includes(11))
    expect(app!.gateway.attentionDigest(host.deviceId)).toEqual(clearDigest)
    expect(wire.ws.readyState).toBe(WebSocket.OPEN)
  })

  it('fails closed on non-host sender, unnegotiated capability, and extra/plaintext fields', async () => {
    await runScenarios([
      {
        name: 'client-sender',
        run: async () => {
          const client = await registerDevice('client', 'evil-client')
          const { wire } = await connectPeer(client, attentionCapabilities)
          const closed = once(wire.ws, 'close')
          wire.send('host.attention.signal', { digest: makeDigest({ revision: 1 }) })
          const errorFrame = await wire.next('error')
          await closed
          expect(errorFrame.code).toBe('MEMBERSHIP_REQUIRED')
          expect(app!.gateway.attentionDigest(client.deviceId)).toBeUndefined()
        },
      },
      {
        name: 'unnegotiated-host',
        run: async () => {
          const host = await registerDevice('host', 'legacy-host')
          const { wire } = await connectPeer(host, legacyCapabilities)
          const closed = once(wire.ws, 'close')
          wire.send('host.attention.signal', { digest: makeDigest({ revision: 1 }) })
          const errorFrame = await wire.next('error')
          await closed
          expect(errorFrame.code).toBe('CAPABILITY_NOT_SUPPORTED')
          expect(app!.gateway.attentionDigest(host.deviceId)).toBeUndefined()
        },
      },
      {
        name: 'extra-plaintext-in-digest',
        run: async () => {
          const host = await registerDevice('host', 'leaky-host')
          const { wire } = await connectPeer(host, attentionCapabilities)
          const closed = once(wire.ws, 'close')
          wire.sendRaw(createControlFrame('host.attention.signal', {
            digest: { ...makeDigest({ revision: 1 }), prompt: 'secret user prompt' },
          }))
          const errorFrame = await wire.next('error')
          await closed
          expect(errorFrame.code).toBe('INVALID_MESSAGE')
          expect(app!.gateway.attentionDigest(host.deviceId)).toBeUndefined()
        },
      },
      {
        name: 'extra-top-level-field',
        run: async () => {
          const host = await registerDevice('host', 'leaky-top-host')
          const { wire } = await connectPeer(host, attentionCapabilities)
          const closed = once(wire.ws, 'close')
          wire.sendRaw(createControlFrame('host.attention.signal', {
            digest: makeDigest({ revision: 1 }),
            sessionTitle: 'should-fail-closed',
          }))
          const errorFrame = await wire.next('error')
          await closed
          expect(errorFrame.code).toBe('INVALID_MESSAGE')
          expect(app!.gateway.attentionDigest(host.deviceId)).toBeUndefined()
        },
      },
      {
        name: 'non-opaque-attention-token',
        run: async () => {
          const host = await registerDevice('host', 'bad-token-host')
          const { wire } = await connectPeer(host, attentionCapabilities)
          const closed = once(wire.ws, 'close')
          wire.sendRaw(createControlFrame('host.attention.signal', {
            digest: { ...makeDigest({ revision: 1 }), attentionToken: 'session-id-plaintext' },
          }))
          const errorFrame = await wire.next('error')
          await closed
          expect(errorFrame.code).toBe('INVALID_MESSAGE')
          expect(app!.gateway.attentionDigest(host.deviceId)).toBeUndefined()
        },
      },
    ])
  })

  it('validates DSH_SERVER_ATTENTION_WEBHOOK_URL against SSRF and credential leaks', async () => {
    expect(parseAttentionWebhookUrl(undefined)).toBeUndefined()
    expect(parseAttentionWebhookUrl('')).toBeUndefined()
    expect(parseAttentionWebhookUrl('   ')).toBeUndefined()

    expect(parseAttentionWebhookUrl('https://hooks.example.com/wake?key=secret')?.origin).toBe('https://hooks.example.com')
    expect(parseAttentionWebhookUrl('http://127.0.0.1:9000/hook')?.origin).toBe('http://127.0.0.1:9000')
    expect(parseAttentionWebhookUrl('http://localhost:9000/hook')?.origin).toBe('http://localhost:9000')
    expect(parseAttentionWebhookUrl('http://[::1]:9000/hook')?.origin).toBe('http://[::1]:9000')

    const invalidCases = [
      { name: 'http-metadata-ip', value: 'http://169.254.169.254/latest/meta-data?token=secret-leak' },
      { name: 'http-private-lan', value: 'http://10.0.0.1/hook' },
      { name: 'http-public-host', value: 'http://hooks.example.com/hook' },
      { name: 'http-other-loopback', value: 'http://127.0.0.2/hook' },
      { name: 'file-scheme', value: 'file:///etc/passwd' },
      { name: 'ftp-scheme', value: 'ftp://example.com/hook' },
      { name: 'embedded-user-pass', value: 'https://user:supersecret@hooks.example.com/hook' },
      { name: 'embedded-user-only', value: 'http://admin@127.0.0.1:9000/hook' },
      { name: 'malformed-url', value: 'not-a-url?secret=supersecret' },
    ]
    await runScenarios(invalidCases.map(({ name, value }) => ({
      name,
      run: () => {
        let caught: Error | undefined
        try {
          parseAttentionWebhookUrl(value)
        } catch (error) {
          caught = error as Error
        }
        expect(caught).toBeInstanceOf(Error)
        expect(caught!.message).not.toContain('supersecret')
        expect(caught!.message).not.toContain('secret-leak')
        expect(() => createRemoteServer({
          account,
          password,
          dataFile: join(dir, `${name}.json`),
          publicUrl: 'http://localhost:8080',
          attentionWebhookUrl: value,
        })).toThrow()
      },
    })))
  })

  it('enforces redirect: manual, body cancel, single-slot coalescing, concurrency <= 2, and redacted logs', async () => {
    // 1. Redirect manual + log redaction (no path/query/token in logs) + body cancel
    const logs: Array<{ line: string; entry: LogEntry }> = []
    const sinkLogger = new Logger('test-webhook', 'debug', (line, entry) => logs.push({ line, entry }))
    let bodyCancelled = 0
    let capturedInit: RequestInit | undefined
    const redirectFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedInit = init
      return {
        ok: false,
        status: 302,
        body: {
          cancel: async () => {
            bodyCancelled += 1
          },
        },
      } as unknown as Response
    }) as typeof fetch

    const redirectDispatcher = new AttentionWebhookDispatcher(
      new URL('https://hooks.example.com/private/path?token=topsecretvalue'),
      { logger: sinkLogger, fetch: redirectFetch, baseBackoffMs: 50, maxBackoffMs: 100 },
    )
    dispatchers.push(redirectDispatcher)
    redirectDispatcher.notify('host-1', 'workstation', makeDigest({ revision: 1 }))
    await waitFor(() => logs.length >= 1)

    expect(capturedInit?.method).toBe('POST')
    expect(capturedInit?.redirect).toBe('manual')
    expect(bodyCancelled).toBe(1)
    expect(logs[0]!.entry.event).toBe('attention_webhook_delivery_failed')
    expect(logs[0]!.entry.meta).toMatchObject({ origin: 'https://hooks.example.com', status: 302 })
    expect(logs[0]!.line).not.toContain('topsecretvalue')
    expect(logs[0]!.line).not.toContain('/private/path')

    // 2. Single-slot coalescing per host + concurrency cap <= 2 + silent/clear transition gating
    const delivered: Array<{ hostId: string; revision: number; urgentKind: string | null }> = []
    let active = 0
    let maxActive = 0
    const gates: Array<() => void> = []
    const gatedFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      const parsed = JSON.parse(String(init?.body))
      delivered.push({ hostId: parsed.hostId, revision: parsed.digest.revision, urgentKind: parsed.digest.urgentKind })
      await new Promise<void>(resolve => gates.push(resolve))
      active -= 1
      return { ok: true, status: 200, body: { cancel: async () => {} } } as unknown as Response
    }) as typeof fetch

    const coalescingDispatcher = new AttentionWebhookDispatcher(
      new URL('http://127.0.0.1:9999/hook'),
      { logger: new Logger('test', 'silent'), fetch: gatedFetch, maxConcurrency: 5 },
    )
    dispatchers.push(coalescingDispatcher)

    // Silent / clear with no prior alert should NOT fire.
    coalescingDispatcher.notify('host-a', 'A', makeDigest({ revision: 1, urgency: 'silent', urgentKind: null }))
    coalescingDispatcher.notify('host-a', 'A', makeDigest({ revision: 2, urgency: 'silent', urgentKind: 'clear' }))
    expect(delivered).toEqual([])

    // Queue bursts across 3 hosts while first 2 requests are blocked in flight.
    coalescingDispatcher.notify('host-a', 'A', makeDigest({ revision: 3, urgency: 'critical', urgentKind: 'approval_needed' }))
    coalescingDispatcher.notify('host-b', 'B', makeDigest({ revision: 1, urgency: 'normal', urgentKind: 'turn_completed' }))
    coalescingDispatcher.notify('host-c', 'C', makeDigest({ revision: 1, urgency: 'critical', urgentKind: 'question_needed' }))

    // Coalesce multiple updates for host-a while rev 3 is still in flight -> only rev 6 survives in single slot!
    coalescingDispatcher.notify('host-a', 'A', makeDigest({ revision: 4, urgency: 'normal', urgentKind: 'turn_completed' }))
    coalescingDispatcher.notify('host-a', 'A', makeDigest({ revision: 5, urgency: 'critical', urgentKind: 'approval_needed' }))
    coalescingDispatcher.notify('host-a', 'A', makeDigest({ revision: 6, urgency: 'silent', urgentKind: 'clear' }))

    await waitFor(() => gates.length === 2)
    expect(maxActive).toBe(2)

    // Release all in-flight fetches sequentially.
    while (delivered.length < 4 || gates.length > 0) {
      const release = gates.shift()
      if (release) release()
      else await new Promise(resolve => setTimeout(resolve, 10))
    }

    expect(maxActive).toBeLessThanOrEqual(2)
    expect(delivered).toEqual([
      { hostId: 'host-a', revision: 3, urgentKind: 'approval_needed' },
      { hostId: 'host-b', revision: 1, urgentKind: 'turn_completed' },
      { hostId: 'host-c', revision: 1, urgentKind: 'question_needed' },
      { hostId: 'host-a', revision: 6, urgentKind: 'clear' },
    ])
  })

  it('delivers zero-plaintext webhook payloads end-to-end to a local HTTP server without following redirects', async () => {
    const received: Array<{ method?: string; contentType?: string; body: unknown }> = []
    let redirectHits = 0
    const webhookServer = createHttpServer((req, res) => {
      if (req.url === '/redirect-target') {
        redirectHits += 1
        res.writeHead(200)
        res.end('ok')
        return
      }
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        const parsed = text ? JSON.parse(text) : undefined
        received.push({ method: req.method, contentType: req.headers['content-type'], body: parsed })
        if (req.url === '/redirect') {
          res.writeHead(302, { Location: '/redirect-target' })
          res.end()
          return
        }
        res.writeHead(204)
        res.end()
      })
    })
    extraServers.push(webhookServer)
    webhookServer.listen(0, '127.0.0.1')
    await once(webhookServer, 'listening')
    const hookPort = (webhookServer.address() as { port: number }).port

    await startServer({ attentionWebhookUrl: `http://127.0.0.1:${hookPort}/hook` })
    const host = await registerDevice('host', 'studio-mac')
    const { wire } = await connectPeer(host, attentionCapabilities)

    // Silent update with no prior alert should NOT trigger webhook.
    wire.send('host.attention.signal', {
      digest: makeDigest({ revision: 1, pendingApprovals: 0, urgentKind: null, urgency: 'silent' }),
    })
    // Meaningful critical alert triggers webhook.
    const alertDigest = makeDigest({ revision: 2, pendingApprovals: 1, urgentKind: 'approval_needed', urgency: 'critical' })
    wire.send('host.attention.signal', { digest: alertDigest })
    await waitFor(() => received.length === 1)

    expect(received[0]).toEqual({
      method: 'POST',
      contentType: 'application/json',
      body: {
        event: 'host.attention.signal',
        hostId: host.deviceId,
        hostName: 'studio-mac',
        digest: alertDigest,
      },
    })

    // Clear after prior alert triggers webhook.
    const clearDigest = makeDigest({
      revision: 3,
      pendingApprovals: 0,
      runningSessions: 0,
      urgentKind: 'clear',
      urgency: 'silent',
    })
    wire.send('host.attention.signal', { digest: clearDigest })
    await waitFor(() => received.length === 2)
    expect(received[1]!.body).toEqual({
      event: 'host.attention.signal',
      hostId: host.deviceId,
      hostName: 'studio-mac',
      digest: clearDigest,
    })

    // Verify redirect is NOT followed end-to-end against real HTTP server.
    await startServer({ attentionWebhookUrl: `http://127.0.0.1:${hookPort}/redirect` })
    const redirectHost = await registerDevice('host', 'redirect-host')
    const { wire: redirectWire } = await connectPeer(redirectHost, attentionCapabilities)
    redirectWire.send('host.attention.signal', {
      digest: makeDigest({ revision: 1, urgentKind: 'approval_needed', urgency: 'critical' }),
    })
    await waitFor(() => received.length === 3)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(redirectHits).toBe(0)
  })

  it('cancels pending webhook slot on host cancel and opens circuit breaker on repeated failures', async () => {
    // 1. Cancel drops queued coalesced slot before delivery.
    const sentRevisions: number[] = []
    let releaseFirst: (() => void) | undefined
    const cancelFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body))
      sentRevisions.push(parsed.digest.revision)
      if (sentRevisions.length === 1) {
        await new Promise<void>(resolve => { releaseFirst = resolve })
      }
      return { ok: true, status: 200, body: { cancel: async () => {} } } as unknown as Response
    }) as typeof fetch

    const cancelDispatcher = new AttentionWebhookDispatcher(
      new URL('http://127.0.0.1:9999/hook'),
      { logger: new Logger('test', 'silent'), fetch: cancelFetch },
    )
    dispatchers.push(cancelDispatcher)
    cancelDispatcher.notify('host-cancel', 'Host', makeDigest({ revision: 1 }))
    await waitFor(() => releaseFirst !== undefined)
    cancelDispatcher.notify('host-cancel', 'Host', makeDigest({ revision: 2 }))
    cancelDispatcher.cancel('host-cancel')
    releaseFirst!()
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(sentRevisions).toEqual([1])

    // 2. Repeated 503 responses trip circuit breaker and suppress further attempts while open.
    const logs: LogEntry[] = []
    let attempts = 0
    const failingFetch = (async () => {
      attempts += 1
      return { ok: false, status: 503, body: { cancel: async () => {} } } as unknown as Response
    }) as typeof fetch

    const cbDispatcher = new AttentionWebhookDispatcher(
      new URL('https://hooks.example.com/secret-path?token=neverlog'),
      {
        logger: new Logger('test-cb', 'warn', (_line, entry) => logs.push(entry)),
        fetch: failingFetch,
        baseBackoffMs: 50,
        maxBackoffMs: 5_000,
        circuitBreakerThreshold: 2,
      },
    )
    dispatchers.push(cbDispatcher)
    cbDispatcher.notify('host-cb', 'Host', makeDigest({ revision: 1 }))
    await waitFor(() => attempts === 1)
    await new Promise(resolve => setTimeout(resolve, 65))
    cbDispatcher.notify('host-cb', 'Host', makeDigest({ revision: 2 }))
    await waitFor(() => attempts === 2)
    expect(logs.some(entry => entry.event === 'attention_webhook_circuit_open' && entry.meta.origin === 'https://hooks.example.com')).toBe(true)

    // While circuit is open, additional notifications are suppressed.
    cbDispatcher.notify('host-cb', 'Host', makeDigest({ revision: 3 }))
    await new Promise(resolve => setTimeout(resolve, 65))
    expect(attempts).toBe(2)
  })
})
