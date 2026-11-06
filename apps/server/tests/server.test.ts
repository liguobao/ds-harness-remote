import { runScenarios, scenarioName } from '../../../scripts/test-scenarios.mjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHmac } from 'node:crypto'
import { once } from 'node:events'
import { createConnection } from 'node:net'
import { request as httpRequest } from 'node:http'
import { WebSocket } from 'ws'
import { MAX_CONTROL_FRAME_BYTES, createControlFrame } from '@dsh-remote/protocol'
import { NoiseIkSession, createNoisePrologue, generateKeyPair, toBase64Url, fromBase64Url } from '../../../packages/crypto/src/index.js'
import { RelayTransport } from '../../../packages/webrtc/src/index.js'
import { ClientSecureTransport } from '../../../packages/plugin/src/client-secure-transport.js'
import { ClientServerApi } from '../../../packages/plugin/src/server-api.js'
import { IdentityStore } from '../../../packages/plugin/src/identity-store.js'
import { ServerCredentialStore } from '../../../packages/plugin/src/server-credentials.js'
import {
  createRemoteServer,
  normalizeGatewayOptions,
  normalizeIp,
  normalizeTrustedProxyIps,
  parseHelloTimeout,
  parseHeartbeatInterval,
  parseHeartbeatDisconnect,
  type Config,
} from '../src/server.js'
import {
  Logger,
  redactSensitive,
  parseLogLevel,
  type LogEntry,
} from '../src/logger.js'
import { MAX_ICE_CANDIDATES_PER_CONNECTION } from '../src/gateway.js'
import { parseIceConfig } from '../src/ice.js'

const account = 'owner@example.com', password = 'local-test-password'
let app: ReturnType<typeof createRemoteServer>, dir: string, base: string, accountToken: string
const sockets: WebSocket[] = []
const secureClients: ClientSecureTransport[] = []
const noiseSessions: NoiseIkSession[] = []
async function request(path: string, method = 'GET', body?: unknown, token?: string, headers = {}) {
  const response = await fetch(`${base}/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, data: await response.json(), headers: response.headers }
}
async function start(pass = password, trustedProxyIps: readonly string[] = [], configOverrides: Partial<Config> = {}) {
  app = createRemoteServer({ account, password: pass, dataFile: join(dir, 'state.json'), publicUrl: 'http://localhost:8080', trustedProxyIps, ...configOverrides })
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening')
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`
}
/** Send a raw HTTP/1.1 request so duplicate header lines stay separate (fetch merges them). */
async function rawStatus(headerLines: string[]): Promise<number> {
  const port = (app.server.address() as { port: number }).port
  const crlf = String.fromCharCode(13, 10)
  const lines = [
    'GET /api/v1/auth/me HTTP/1.1',
    `Host: 127.0.0.1:${port}`,
    ...headerLines,
    'Connection: close',
    '',
    '',
  ]
  return await new Promise<number>((resolve, reject) => {
    const socket = createConnection(port, '127.0.0.1')
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('raw request timed out')) }, 5000)
    let buffer = ''
    socket.on('connect', () => socket.write(lines.join(crlf)))
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8')
      const match = /^HTTP[/]1[.][01] ([0-9]{3})/.exec(buffer)
      if (!match) return
      clearTimeout(timer); socket.destroy(); resolve(Number(match[1]))
    })
    socket.on('error', error => { clearTimeout(timer); reject(error) })
  })
}
async function device(role: 'host' | 'client' = 'client') {
  const keys = generateKeyPair()
  const descriptor = { deviceId: randomUUID(), identityKey: keys.publicKey, name: 'test-device', role, platform: 'linux', clientVersion: '0.4.15' }
  const result = await request('/devices/register', 'POST', { v: 1, device: descriptor }, accountToken)
  expect(result.status).toBe(200)
  return { ...descriptor, keys, ...result.data }
}
class Wire {
  messages: any[] = []
  waiters: (() => void)[] = []
  constructor(readonly ws: WebSocket) { ws.on('message', raw => { this.messages.push(JSON.parse(raw.toString())); for (const notify of this.waiters.splice(0)) notify() }) }
  send(type: Parameters<typeof createControlFrame>[0], payload: unknown) { this.ws.send(JSON.stringify(createControlFrame(type, payload))) }
  async next(type: string): Promise<any> {
    const until = Date.now() + 3000
    while (Date.now() < until) {
      const idx = this.messages.findIndex(m => m.type === type)
      if (idx >= 0) return this.messages.splice(idx, 1)[0].payload
      await new Promise<void>(resolve => { const timer = setTimeout(resolve, 50); this.waiters.push(() => { clearTimeout(timer); resolve() }) })
    }
    throw new Error(`Missing frame ${type}`)
  }
}
const fullCapabilities = ['transport.lan', 'transport.p2p', 'transport.turn', 'transport.relay']
const fullPreferredTransports = ['lan', 'p2p', 'turn', 'relay']
async function socket(d: Awaited<ReturnType<typeof device>>, overrides = {}) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/v1/connect'); sockets.push(ws)
  const wire = new Wire(ws); await once(ws, 'open')
  wire.send('hello', { role: d.role, deviceId: d.deviceId, accessToken: d.accessToken, protocols: [1], capabilities: fullCapabilities, clientVersion: d.clientVersion, ...overrides })
  return wire
}
async function connection(options: { hostCapabilities?: string[]; clientCapabilities?: string[]; preferredTransports?: string[] } = {}) {
  const h = await device('host'), c = await device()
  const host = await socket(h, options.hostCapabilities === undefined ? {} : { capabilities: options.hostCapabilities })
  const client = await socket(c, options.clientCapabilities === undefined ? {} : { capabilities: options.clientCapabilities })
  const ack = await host.next('hello.ack')
  expect(ack).toMatchObject({ webrtcEnabled: true })
  expect(ack.capabilities).toEqual(expect.arrayContaining(['transport.relay']))
  await client.next('hello.ack')
  client.send('connect.request', { hostDeviceId: h.deviceId, preferredTransports: options.preferredTransports ?? ['relay'] })
  const incoming = await host.next('connect.incoming')
  expect(incoming.clientIdentityKey).toBe(c.identityKey)
  host.send('connect.accepted', { connectionId: incoming.connectionId })
  const { connectionId } = await client.next('connect.accepted')
  return { h, c, host, client, connectionId, incoming }
}
async function handshake(ctx: Awaited<ReturnType<typeof connection>>) {
  const { h, c, host, client, connectionId } = ctx
  const prologue = createNoisePrologue(connectionId, h.deviceId, c.deviceId)
  const initiator = new NoiseIkSession({ role: 'initiator', localPrivateKey: c.keys.privateKey, localPublicKey: c.identityKey, remotePublicKey: h.identityKey, prologue })
  const responder = new NoiseIkSession({ role: 'responder', localPrivateKey: h.keys.privateKey, localPublicKey: h.identityKey, remotePublicKey: c.identityKey, prologue })
  noiseSessions.push(initiator, responder)
  client.send('secure.handshake', { connectionId, targetDeviceId: h.deviceId, step: 1, data: toBase64Url(initiator.writeHandshake()) })
  responder.readHandshake(fromBase64Url((await host.next('secure.handshake')).data))
  host.send('secure.handshake', { connectionId, targetDeviceId: c.deviceId, step: 2, data: toBase64Url(responder.writeHandshake()) })
  initiator.readHandshake(fromBase64Url((await client.next('secure.handshake')).data))
  return { initiator, responder }
}
async function secureConnection() {
  const h = await device('host'), c = await device(), host = await socket(h)
  await host.next('hello.ack')
  const relay = new RelayTransport(base.replace('http:', 'ws:') + '/ws/v1/connect', {
    role: 'client', deviceId: c.deviceId, accessToken: c.accessToken, targetDeviceId: h.deviceId,
  })
  const secure = new ClientSecureTransport(relay, {
    schemaVersion: 1, deviceId: c.deviceId, name: c.name, ...c.keys, fingerprint: 'test-client',
  }, {
    deviceId: h.deviceId, name: h.name, platform: h.platform, publicKey: h.identityKey,
    fingerprint: 'test-host', trustedAt: Date.now(),
  })
  secureClients.push(secure)
  const received: string[] = []
  secure.onMessage(data => received.push(new TextDecoder().decode(data)))
  const connecting = secure.connect().then(() => undefined, error => error as Error)
  const incoming = await host.next('connect.incoming')
  const connectionId: string = incoming.connectionId
  host.send('connect.accepted', { connectionId })
  const responder = new NoiseIkSession({
    role: 'responder', localPrivateKey: h.keys.privateKey, localPublicKey: h.identityKey,
    remotePublicKey: c.identityKey, prologue: createNoisePrologue(connectionId, h.deviceId, c.deviceId),
  })
  noiseSessions.push(responder)
  const first = await host.next('secure.handshake')
  expect(first).toMatchObject({ connectionId, targetDeviceId: h.deviceId, step: 1 })
  responder.readHandshake(fromBase64Url(first.data))
  host.send('secure.handshake', { connectionId, targetDeviceId: c.deviceId, step: 2, data: toBase64Url(responder.writeHandshake()) })
  const error = await connecting
  if (error) throw error
  return { h, c, host, secure, responder, connectionId, received }
}
const prepareScenario1 = async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-server-'))
  await start()
  accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
}
beforeEach(prepareScenario1)
const cleanupScenario2 = async () => {
  for (const secure of secureClients.splice(0)) await secure.close()
  for (const noise of noiseSessions.splice(0)) noise.destroy()
  for (const ws of sockets.splice(0)) ws.terminate()
  await app.close()
  rmSync(dir, { recursive: true, force: true })
}
afterEach(cleanupScenario2)

describe('account and device authorization', () => {
  it('separates account, cookie and device credentials; rejects cross-origin requests', async () => {
    expect((await request('/auth/login', 'POST', { email: account, password: 'wrong' })).status).toBe(401)
    expect((await request('/auth/login', 'POST', { email: account, password }, undefined, { Origin: 'https://attacker.example' })).status).toBe(403)
    const d = await device()
    expect((await request('/auth/me', 'GET', undefined, d.accessToken)).status).toBe(401)
    expect((await request('/devices', 'GET', undefined, accountToken)).status).toBe(401)
    expect((await request('/devices/register', 'POST', { v: 1, device: d })).status).toBe(401)
    const login = await request('/auth/login', 'POST', { email: account, password })
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!
    expect(login.headers.get('set-cookie')).toContain('HttpOnly')
    expect((await request('/account/devices', 'GET', undefined, undefined, { Cookie: cookie })).status).toBe(200)
    await request('/auth/logout', 'POST', {}, undefined, { Cookie: cookie })
    expect((await request('/auth/me', 'GET', undefined, login.data.token)).status).toBe(401)
  })
  it('pins identity and requires distinct opposite-role registration', async () => {
    const h = await device('host'), c = await device()
    const changed = { deviceId: h.deviceId, name: h.name, role: h.role, platform: h.platform, clientVersion: h.clientVersion, identityKey: c.identityKey }
    expect((await request('/devices/register', 'POST', { v: 1, device: changed }, accountToken)).data.error.code).toBe('PEER_IDENTITY_MISMATCH')
    expect((await request(`/devices/${h.deviceId}`, 'GET', undefined, c.accessToken)).data.identityKey).toBe(h.identityKey)
    expect((await request(`/devices/${c.deviceId}`, 'GET', undefined, c.accessToken)).status).toBe(403)
    const descriptor = { ...changed, deviceId: randomUUID() }
    expect((await request('/devices/register-owned-role', 'POST', { v: 1, device: descriptor }, h.accessToken)).status).toBe(409)
    expect((await request('/devices/register-owned-role', 'POST', { v: 1, device: descriptor }, c.accessToken)).status).toBe(200)
  })
  it('recovers a lost refresh response across restart without invalidating the successor', async () => {
    const d = await device()
    const saved = readFileSync(join(dir, 'state.json'), 'utf8')
    expect(saved).not.toContain(d.refreshToken); expect(saved).not.toContain(d.accessToken); expect(saved).not.toContain(password)
    await app.close(); await start()
    expect((await request('/devices', 'GET', undefined, d.accessToken)).status).toBe(200)
    // Discard the successful response body, as when the link drops after commit.
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(base + '/api/v1/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
        const status = res.statusCode
        res.destroy()
        if (status === 200) resolve()
        else reject(new Error('Expected successful rotation before response loss'))
      })
      req.on('error', reject)
      req.end(JSON.stringify({ deviceId: d.deviceId, refreshToken: d.refreshToken }))
    })
    await app.close(); await start()
    const rotated = await request('/auth/refresh', 'POST', { deviceId: d.deviceId, refreshToken: d.refreshToken })
    expect(rotated.status).toBe(200)
    expect(rotated.data.refreshTokenExpiresAt).toBe(d.refreshTokenExpiresAt)
    const retries = await Promise.all(Array.from({ length: 3 }, () => request('/auth/refresh', 'POST', { deviceId: d.deviceId, refreshToken: d.refreshToken })))
    for (const retry of retries) { expect(retry.status).toBe(200); expect(retry.data).toEqual(rotated.data) }
    expect((await request('/devices', 'GET', undefined, rotated.data.accessToken)).status).toBe(200)
    const next = await request('/auth/refresh', 'POST', { deviceId: d.deviceId, refreshToken: rotated.data.refreshToken })
    expect(next.status).toBe(200)
    expect((await request('/auth/refresh', 'POST', { deviceId: d.deviceId, refreshToken: d.refreshToken })).status).toBe(401)
    expect((await request('/devices', 'GET', undefined, next.data.accessToken)).status).toBe(200)
    const persisted = readFileSync(join(dir, 'state.json'), 'utf8')
    for (const value of [d.accessToken, d.refreshToken, rotated.data.accessToken, rotated.data.refreshToken, next.data.refreshToken]) {
      expect(persisted).not.toContain(value)
    }
  })
  it('lets the Plugin recover a dropped refresh response without signing in again, even after access expiry', async () => {
    await runScenarios([0, 2 * 60 * 60_000].map(delay => ({
      name: delay === 0 ? 'immediate retry' : 'two hours offline', run: async () => {
        const identity = await new IdentityStore({ directory: join(dir, `identity-${delay}`) }).loadOrCreate('test')
        const credentials = new ServerCredentialStore(join(dir, `client-${delay}`))
        let loseResponse = true, logins = 0, registrations = 0
        const api = new ClientServerApi(base, credentials, async (url, init) => {
          if (url.endsWith('/auth/login')) logins++
          if (url.endsWith('/devices/register')) registrations++
          const response = await fetch(url, init)
          if (loseResponse && url.endsWith('/auth/refresh')) {
            loseResponse = false
            expect(response.status).toBe(200)
            await response.arrayBuffer()
            throw new TypeError('Simulated response loss after Server commit')
          }
          return response
        })
        await api.authorizeWithAccount(identity, account, password)
        const before = await credentials.load(base, identity.deviceId)
        await expect(api.refreshCredentials()).rejects.toMatchObject({ code: 'CONNECTION_FAILED', phase: 'credential_refresh' })
        expect(await credentials.load(base, identity.deviceId)).toEqual(before)
        const now = Date.now() + delay
        const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
        try {
          if (delay === 0) await api.refreshCredentials()
          await expect(api.listDevices()).resolves.toEqual([])
          const recovered = await credentials.load(base, identity.deviceId)
          expect(recovered?.refreshToken).not.toBe(before?.refreshToken)
          expect(recovered?.accessTokenExpiresAt).toBeGreaterThan(now)
          expect(recovered?.refreshTokenExpiresAt).toBe(before?.refreshTokenExpiresAt)
          expect(logins).toBe(1); expect(registrations).toBe(1)
        } finally { clock.mockRestore() }
      },
    })))
  })
  it('invalidates credentials when the configured password changes', async () => {
    const d = await device(); await app.close(); await start('a-different-password')
    expect((await request('/devices', 'GET', undefined, d.accessToken)).status).toBe(401)
    expect((await request('/auth/refresh', 'POST', { deviceId: d.deviceId, refreshToken: d.refreshToken })).status).toBe(401)
  })
})
describe('control authorization and encrypted relay', () => {
  it('rejects invalid Control messages at the WebSocket boundary', async () => {
    await runScenarios(['unsupported-version', 'binary-control', 'oversized-control', 'unknown-frame-type'].map(reason => ({
      name: reason,
      run: async () => {
        const wire = await socket(await device())
        await wire.next('hello.ack')
        const closed = once(wire.ws, 'close')
        const frame = {
          ...createControlFrame('ping', { nonce: reason === 'oversized-control' ? 'a'.repeat(MAX_CONTROL_FRAME_BYTES) : 'test' }),
          ...(reason === 'unsupported-version' ? { v: 2 } : {}),
          ...(reason === 'unknown-frame-type' ? { type: 'unknown' } : {}),
        }
        wire.ws.send(JSON.stringify(frame), { binary: reason === 'binary-control' })
        expect((await wire.next('error')).code).toBe(reason === 'unsupported-version' ? 'UNSUPPORTED_VERSION' : 'INVALID_MESSAGE')
        expect((await closed)[0]).toBe(4001)
      },
    })), async () => {
      await cleanupScenario2()
      await prepareScenario1()
    })
  })
  it('relays real Noise IK ciphertext and rejects replay', async () => {
    const ctx = await connection(), { initiator, responder } = await handshake(ctx)
    const ciphertext = toBase64Url(initiator.encrypt(new TextEncoder().encode('private prompt')))
    const payload = { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, counter: 0, ciphertext }
    ctx.client.send('relay', payload)
    const received = await ctx.host.next('relay')
    expect(received.ciphertext).not.toContain('private prompt')
    expect(new TextDecoder().decode(responder.decrypt(fromBase64Url(received.ciphertext)))).toBe('private prompt')
    ctx.client.send('relay', payload)
    expect((await ctx.client.next('error')).code).toBe('INVALID_MESSAGE')
  })
  it('rejects unauthorized relay routes', async () => {
    const rows = ['wrong-target', 'third-device', 'unknown-connection', 'before-handshake'] as const
    await runScenarios(
      rows.map((row, index) => {
        const reason = row
        return {
          name: scenarioName('rejects unauthorized relay: %s', row, index),
          run: async () => {
            const ctx = await connection()
            if (reason !== 'before-handshake') await handshake(ctx)
            const attacker = reason === 'third-device' ? await socket(await device()) : ctx.client
            if (reason === 'third-device') await attacker.next('hello.ack')
            attacker.send('relay', {
              connectionId: reason === 'unknown-connection' ? randomUUID() : ctx.connectionId,
              targetDeviceId: reason === 'wrong-target' ? randomUUID() : ctx.h.deviceId,
              counter: 0,
              ciphertext: 'AQIDBA',
            })
            expect((await attacker.next('error')).code).toBe(reason === 'before-handshake' ? 'INVALID_MESSAGE' : 'CONNECTION_NOT_FOUND')
            ctx.host.send('ping', { nonce: 'route-check' })
            await ctx.host.next('pong')
            expect(ctx.host.messages.filter((m) => m.type === 'relay')).toHaveLength(0)
          },
        }
      }),
      async () => {
        await cleanupScenario2()
        await prepareScenario1()
      },
    )
  })
  it('closes the production Client secure channel after relayed tampering or ciphertext replay', async () => {
    await runScenarios(['tamper', 'replay-with-new-counter'].map(reason => ({
      name: reason,
      run: async () => {
        const ctx = await secureConnection()
        await ctx.secure.send(new TextEncoder().encode('synthetic request'))
        const request = await ctx.host.next('relay')
        expect(new TextDecoder().decode(ctx.responder.decrypt(fromBase64Url(request.ciphertext)))).toBe('synthetic request')
        const ciphertext = ctx.responder.encrypt(new TextEncoder().encode('synthetic response'))
        const payload = { connectionId: ctx.connectionId, targetDeviceId: ctx.c.deviceId, counter: 0, ciphertext: toBase64Url(ciphertext) }
        if (reason === 'replay-with-new-counter') {
          ctx.host.send('relay', payload)
          await expect.poll(() => ctx.received, { timeout: 3000, interval: 50 }).toEqual(['synthetic response'])
          payload.counter = 1
        } else {
          ciphertext[ciphertext.length - 1]! ^= 1
          payload.ciphertext = toBase64Url(ciphertext)
        }
        const before = ctx.secure.getStats().bytesReceived ?? 0
        ctx.host.send('relay', payload)
        await expect.poll(() => ctx.secure.getStats().bytesReceived, { timeout: 3000, interval: 50 })
          .toBe(before + fromBase64Url(payload.ciphertext).byteLength)
        await expect.poll(() => ctx.secure.getStats().connected, { timeout: 3000, interval: 50 }).toBe(false)
        expect(ctx.received).toEqual(reason === 'tamper' ? [] : ['synthetic response'])
        await expect(ctx.secure.send(new Uint8Array([1]))).rejects.toThrow('The authenticated Noise channel is not connected.')
        // The Host keeps its Control socket after one Client channel fails.
        ctx.host.send('ping', { nonce: 'host-still-online' })
        expect(await ctx.host.next('pong')).toEqual({ nonce: 'host-still-online' })
      },
    })), async () => {
      await cleanupScenario2()
      await prepareScenario1()
    })
  }, 15000)
  it('rejects a relayed initiator whose static identity or connection prologue differs from local trust', async () => {
    await runScenarios(['wrong-static-key', 'wrong-prologue'].map(reason => ({
      name: reason,
      run: async () => {
        const ctx = await connection()
        const prologue = createNoisePrologue(ctx.connectionId, ctx.h.deviceId, ctx.c.deviceId)
        const initiator = new NoiseIkSession({
          role: 'initiator', localPrivateKey: ctx.c.keys.privateKey, localPublicKey: ctx.c.identityKey,
          remotePublicKey: ctx.h.identityKey, prologue,
        })
        const responder = new NoiseIkSession({
          role: 'responder', localPrivateKey: ctx.h.keys.privateKey, localPublicKey: ctx.h.identityKey,
          remotePublicKey: reason === 'wrong-static-key' ? generateKeyPair().publicKey : ctx.c.identityKey,
          prologue: reason === 'wrong-prologue' ? createNoisePrologue(randomUUID(), ctx.h.deviceId, ctx.c.deviceId) : prologue,
        })
        noiseSessions.push(initiator, responder)
        ctx.client.send('secure.handshake', {
          connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, step: 1, data: toBase64Url(initiator.writeHandshake()),
        })
        const received = await ctx.host.next('secure.handshake')
        const read = () => responder.readHandshake(fromBase64Url(received.data))
        if (reason === 'wrong-static-key') expect(read).toThrow(/static key/)
        else expect(read).toThrow()
        expect(responder.complete).toBe(false)
        expect(() => responder.encrypt(new Uint8Array([1]))).toThrow()
        ctx.client.send('relay', {
          connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, counter: 0, ciphertext: 'AQIDBA',
        })
        expect((await ctx.client.next('error')).code).toBe('INVALID_MESSAGE')
        ctx.host.send('ping', { nonce: 'handshake-check' })
        await ctx.host.next('pong')
        expect(ctx.host.messages.filter(m => m.type === 'relay')).toHaveLength(0)
      },
    })), async () => {
      await cleanupScenario2()
      await prepareScenario1()
    })
  })
  it('rejects account tokens and mismatched device roles in hello', async () => {
    const d = await device()
    expect((await (await socket(d, { accessToken: accountToken })).next('error')).code).toBe('AUTH_INVALID')
    expect((await (await socket(d, { role: 'host' })).next('error')).code).toBe('AUTH_INVALID')
  })
  it('replaces a device socket without removing the new connection', async () => {
    const d = await device(), old = await socket(d); await old.next('hello.ack')
    const closed = once(old.ws, 'close'), current = await socket(d)
    await current.next('hello.ack'); expect((await closed)[0]).toBe(4003)
    current.send('ping', { nonce: 'new-socket' }); expect(await current.next('pong')).toEqual({ nonce: 'new-socket' })
  })
  it('keeps concurrent clients isolated and tears down revoked connections', async () => {
    const ctx = await connection(), second = await device(), wire = await socket(second); await wire.next('hello.ack')
    wire.send('connect.request', { hostDeviceId: ctx.h.deviceId, preferredTransports: ['relay'] })
    const incoming = await ctx.host.next('connect.incoming')
    ctx.host.send('connect.accepted', { connectionId: incoming.connectionId }); await wire.next('connect.accepted')
    expect(ctx.client.messages.filter(m => m.type === 'error')).toHaveLength(0)
    await handshake(ctx)
    const closed = once(wire.ws, 'close')
    expect((await request('/devices/self', 'DELETE', undefined, second.accessToken)).status).toBe(200)
    await closed
    expect(await ctx.host.next('error')).toMatchObject({ connectionId: incoming.connectionId })
    expect((await request('/devices', 'GET', undefined, second.accessToken)).status).toBe(401)
  })
})


describe('webrtc signaling and TURN credentials', () => {
  const candidate = (index: number) => ({
    candidate: `candidate:${index} 1 udp 2122260223 192.0.2.1 ${50000 + index} typ host`,
    sdpMid: '0',
    sdpMLineIndex: 0,
  })

  it('advertises the negotiated WebRTC transports and only enables TURN when configured', async () => {
    const partial = await socket(await device(), { capabilities: ['transport.p2p', 'transport.relay'] })
    expect(await partial.next('hello.ack')).toMatchObject({
      capabilities: ['transport.p2p', 'transport.relay'],
      webrtcEnabled: true,
      webrtcFallbackTimeoutMs: 12_000,
    })
    const withoutTurn = await socket(await device(), { capabilities: fullCapabilities })
    expect(await withoutTurn.next('hello.ack')).toMatchObject({
      capabilities: ['transport.lan', 'transport.p2p', 'transport.relay'],
    })
    await app.close()
    await start(password, [], {
      ice: {
        stunUrls: ['stun:stun.example.test:3478'],
        turnUrls: ['turn:turn.example.test:3478?transport=udp'],
        turnSecret: 'test-turn-secret',
        turnTtlSeconds: 120,
      },
    })
    accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
    const withTurn = await socket(await device(), { capabilities: fullCapabilities })
    expect(await withTurn.next('hello.ack')).toMatchObject({ capabilities: fullCapabilities })
  })

  it('forwards ordered WebRTC signaling and transport selection', async () => {
    const ctx = await connection({ hostCapabilities: fullCapabilities, clientCapabilities: fullCapabilities, preferredTransports: fullPreferredTransports })
    ctx.client.send('signal.offer', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, sdp: 'v=0 offer' })
    expect(await ctx.host.next('signal.offer')).toMatchObject({ connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId })
    ctx.host.send('signal.answer', { connectionId: ctx.connectionId, targetDeviceId: ctx.c.deviceId, sdp: 'v=0 answer' })
    expect(await ctx.client.next('signal.answer')).toMatchObject({ sdp: 'v=0 answer' })
    for (let index = 0; index < 3; index++) {
      ctx.client.send('signal.ice', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, candidate: candidate(index) })
    }
    for (let index = 0; index < 3; index++) {
      expect((await ctx.host.next('signal.ice')).candidate).toEqual(candidate(index))
    }
    ctx.client.send('transport.selected', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, transport: 'lan' })
    expect(await ctx.host.next('transport.selected')).toMatchObject({ transport: 'lan' })
  })

  it('downgrades LAN to P2P for a host that did not negotiate transport.lan', async () => {
    const ctx = await connection({ hostCapabilities: ['transport.p2p', 'transport.relay'], clientCapabilities: fullCapabilities, preferredTransports: fullPreferredTransports })
    ctx.client.send('transport.selected', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, transport: 'lan' })
    expect(await ctx.host.next('transport.selected')).toMatchObject({ transport: 'p2p' })
  })

  it('tolerates a responder transport selection without dropping the link', async () => {
    const ctx = await connection({ hostCapabilities: fullCapabilities, clientCapabilities: fullCapabilities, preferredTransports: fullPreferredTransports })
    ctx.client.send('transport.selected', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, transport: 'lan' })
    expect(await ctx.host.next('transport.selected')).toMatchObject({ transport: 'lan' })
    // The Host (responder) also announces its own selection; it must be
    // ignored rather than treated as an invalid frame that drops the link.
    ctx.host.send('transport.selected', { connectionId: ctx.connectionId, targetDeviceId: ctx.c.deviceId, transport: 'p2p' })
    ctx.client.send('ping', { nonce: 'responder-selection' })
    expect(await ctx.client.next('pong')).toEqual({ nonce: 'responder-selection' })
    expect(ctx.client.messages.filter(message => message.type === 'error')).toHaveLength(0)
  })

  it('does not forward signaling to a host that cannot use WebRTC', async () => {
    const ctx = await connection({ hostCapabilities: ['transport.relay'], clientCapabilities: fullCapabilities, preferredTransports: fullPreferredTransports })
    ctx.client.send('signal.offer', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, sdp: 'v=0 offer' })
    ctx.client.send('signal.ice', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, candidate: candidate(0) })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(ctx.host.messages.filter(message => message.type === 'signal.offer' || message.type === 'signal.ice')).toHaveLength(0)
    await handshake(ctx)
    ctx.client.send('relay', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, counter: 0, ciphertext: 'AQIDBA' })
    expect(await ctx.host.next('relay')).toMatchObject({ connectionId: ctx.connectionId })
  })

  it('drops signaling on a relay-only link without closing the connection', async () => {
    const ctx = await connection({ hostCapabilities: fullCapabilities, clientCapabilities: fullCapabilities, preferredTransports: ['relay'] })
    // Both peers support WebRTC, but this link only negotiated Relay (e.g. a
    // force-relay Client). Signaling must be dropped instead of forwarded: the
    // Host treats unsolicited signaling as a protocol violation that would
    // close its whole Control connection.
    ctx.client.send('signal.offer', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, sdp: 'v=0 offer' })
    ctx.client.send('signal.ice', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, candidate: candidate(0) })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(ctx.host.messages.filter(message => message.type === 'signal.offer' || message.type === 'signal.ice')).toHaveLength(0)
    expect(ctx.client.messages.filter(message => message.type === 'error')).toHaveLength(0)
    await handshake(ctx)
    ctx.client.send('relay', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, counter: 0, ciphertext: 'AQIDBA' })
    expect(await ctx.host.next('relay')).toMatchObject({ connectionId: ctx.connectionId })
  })

  it('narrows connect.incoming to the transports both peers support', async () => {
    const ctx = await connection({ hostCapabilities: ['transport.lan', 'transport.p2p', 'transport.relay'], clientCapabilities: fullCapabilities, preferredTransports: fullPreferredTransports })
    // The TURN transport is also absent because this test Server has no TURN
    // deployment configured, so the intersection cannot include it.
    expect(ctx.incoming.preferredTransports).toEqual(['lan', 'p2p', 'relay'])
    ctx.client.send('transport.selected', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, transport: 'turn' })
    expect((await ctx.client.next('error')).code).toBe('CAPABILITY_NOT_SUPPORTED')
  })

  it('enforces the per-connection ICE candidate limit', async () => {
    const ctx = await connection({ hostCapabilities: fullCapabilities, clientCapabilities: fullCapabilities, preferredTransports: fullPreferredTransports })
    for (let index = 0; index < MAX_ICE_CANDIDATES_PER_CONNECTION; index++) {
      ctx.client.send('signal.ice', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, candidate: candidate(index) })
    }
    ctx.client.send('signal.ice', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, candidate: candidate(MAX_ICE_CANDIDATES_PER_CONNECTION) })
    expect((await ctx.client.next('error')).code).toBe('INVALID_MESSAGE')
  })

  it('issues short-lived STUN/TURN credentials only to connection participants', async () => {
    await app.close()
    await start(password, [], {
      ice: {
        stunUrls: ['stun:stun.example.test:3478'],
        turnUrls: ['turn:turn.example.test:3478?transport=udp'],
        turnSecret: 'test-turn-secret',
        turnTtlSeconds: 120,
      },
    })
    accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
    const ctx = await connection({ hostCapabilities: fullCapabilities, clientCapabilities: fullCapabilities, preferredTransports: fullPreferredTransports })
    // Negotiate TURN before selecting it; the diagnostic must survive forwarding.
    ctx.client.send('transport.selected', { connectionId: ctx.connectionId, targetDeviceId: ctx.h.deviceId, transport: 'turn', turnNode: 'turn.example.test:3478' })
    expect(await ctx.host.next('transport.selected')).toMatchObject({ transport: 'turn', turnNode: 'turn.example.test:3478' })
    const before = Date.now()
    const result = await request(`/turn/credentials?connection_id=${ctx.connectionId}`, 'GET', undefined, ctx.c.accessToken)
    expect(result.status).toBe(200)
    const [stun, turn] = result.data.iceServers as Array<{ urls: string; username?: string; credential?: string }>
    expect(stun).toEqual({ urls: 'stun:stun.example.test:3478' })
    const expiresAt = Number(String(turn!.username).split(':')[0])
    expect(expiresAt).toBeGreaterThanOrEqual(Math.floor(before / 1000) + 120)
    expect(expiresAt).toBeLessThanOrEqual(Math.ceil(Date.now() / 1000) + 120)
    expect(turn!.credential).toBe(createHmac('sha1', 'test-turn-secret').update(turn!.username!).digest('base64'))
    expect((await request(`/turn/credentials?connection_id=${ctx.connectionId}`, 'GET', undefined, ctx.h.accessToken)).status).toBe(200)

    const stranger = await device()
    expect((await request(`/turn/credentials?connection_id=${ctx.connectionId}`, 'GET', undefined, stranger.accessToken)).status).toBe(404)
    expect((await request(`/turn/credentials?connection_id=${randomUUID()}`, 'GET', undefined, ctx.c.accessToken)).status).toBe(404)
    expect((await request('/turn/credentials', 'GET', undefined, ctx.c.accessToken)).status).toBe(400)

    await handshake(ctx)
    expect((await request(`/turn/credentials?connection_id=${ctx.connectionId}`, 'GET', undefined, ctx.c.accessToken)).status).toBe(404)
  })

  it('issues configured static TURN credentials', async () => {
    await app.close()
    await start(password, [], {
      ice: {
        stunUrls: [],
        turnUrls: ['turn:turn.example.test:3478'],
        turnSecret: undefined,
        turnUsername: 'remote',
        turnPassword: 'static-turn-password',
        turnTtlSeconds: 120,
      },
    })
    accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
    const ctx = await connection({ hostCapabilities: fullCapabilities, clientCapabilities: fullCapabilities })
    const result = await request(`/turn/credentials?connection_id=${ctx.connectionId}`, 'GET', undefined, ctx.c.accessToken)
    expect(result.status).toBe(200)
    expect(result.data.iceServers).toEqual([{ urls: 'turn:turn.example.test:3478', username: 'remote', credential: 'static-turn-password' }])
  })

  it('rejects partial TURN credential configuration at startup', async () => {
    await runScenarios([
      {
        name: 'urls without any credential source',
        run: () => {
          expect(() => parseIceConfig({ DSH_SERVER_TURN_URLS: 'turn:turn.example.test:3478' })).toThrow(/DSH_SERVER_TURN_URLS requires/)
        },
      },
      {
        name: 'secret together with static credentials',
        run: () => {
          expect(() => parseIceConfig({
            DSH_SERVER_TURN_URLS: 'turn:turn.example.test:3478',
            DSH_SERVER_TURN_SECRET: 'secret',
            DSH_SERVER_TURN_USERNAME: 'remote',
            DSH_SERVER_TURN_PASSWORD: 'password',
          })).toThrow(/not both/)
        },
      },
      {
        name: 'static username without password',
        run: () => {
          expect(() => parseIceConfig({
            DSH_SERVER_TURN_URLS: 'turn:turn.example.test:3478',
            DSH_SERVER_TURN_USERNAME: 'remote',
          })).toThrow(/together/)
        },
      },
      {
        name: 'static credentials without urls',
        run: () => {
          expect(() => parseIceConfig({
            DSH_SERVER_TURN_USERNAME: 'remote',
            DSH_SERVER_TURN_PASSWORD: 'password',
          })).toThrow(/DSH_SERVER_TURN_URLS is required/)
        },
      },
      {
        name: 'secret without urls',
        run: () => {
          expect(() => parseIceConfig({ DSH_SERVER_TURN_SECRET: 'secret' })).toThrow(/DSH_SERVER_TURN_URLS is required/)
        },
      },
      {
        name: 'accepts a complete static pair',
        run: () => {
          expect(parseIceConfig({
            DSH_SERVER_TURN_URLS: 'turn:turn.example.test:3478',
            DSH_SERVER_TURN_USERNAME: 'remote',
            DSH_SERVER_TURN_PASSWORD: 'password',
          })).toMatchObject({ turnUsername: 'remote', turnPassword: 'password', turnSecret: undefined })
        },
      },
    ])
  })

  it('does not issue TURN credentials before the host accepts the connection', async () => {
    await app.close()
    await start(password, [], {
      ice: {
        stunUrls: [],
        turnUrls: ['turn:turn.example.test:3478'],
        turnSecret: 'test-turn-secret',
        turnTtlSeconds: 120,
      },
    })
    accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
    const h = await device('host'), c = await device(), host = await socket(h), client = await socket(c)
    await host.next('hello.ack'); await client.next('hello.ack')
    client.send('connect.request', { hostDeviceId: h.deviceId, preferredTransports: ['relay'] })
    const incoming = await host.next('connect.incoming')
    expect((await request(`/turn/credentials?connection_id=${incoming.connectionId}`, 'GET', undefined, c.accessToken)).status).toBe(404)
  })
})

describe('reverse-proxy client IP rate limiting', () => {
  const trusted = ['127.0.0.1', '::ffff:127.0.0.1']
  const forwarded = (ip: string) => ({ 'x-forwarded-for': ip })
  const restart = async (ips: readonly string[] = trusted) => { await app.close(); await start(password, ips) }

  it('normalizes IPv4, IPv6 and IPv4-mapped IPv6 to one canonical form', () => {
    expect(normalizeIp('127.0.0.1')).toBe('127.0.0.1')
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1')
    expect(normalizeIp('::ffff:7f00:1')).toBe('127.0.0.1')
    expect(normalizeIp('0:0:0:0:0:ffff:127.0.0.1')).toBe('127.0.0.1')
    expect(normalizeIp('2001:0DB8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1')
    expect([...normalizeTrustedProxyIps(['127.0.0.1', '::ffff:127.0.0.1', '2001:db8::2'])]).toEqual(['127.0.0.1', '2001:db8::2'])
    for (const invalid of ['', '10.0.0.0/8', '10.0.0.1:8080', '[::1]:8080', 'client.example.com', '1.2.3.4, 5.6.7.8', 'fe80::1%eth0']) {
      expect(normalizeIp(invalid)).toBeNull()
    }
  })

  it('rejects invalid trusted proxy IP lists at startup', () => {
    for (const invalid of ['10.0.0.0/8', 'proxy.example.com', '127.0.0.1:8080', '999.1.1.1', '::1/128', '']) {
      expect(() => createRemoteServer({ account, password, dataFile: join(dir, 'invalid.json'), publicUrl: 'http://localhost:8080', trustedProxyIps: [invalid] })).toThrow(/DSH_SERVER_TRUSTED_PROXY_IPS/)
    }
  })

  it('keeps client B working after client A exhausts the 20/min login limit', async () => {
    await restart()
    const A = forwarded('10.20.0.1'), B = forwarded('10.20.0.2')
    expect((await request('/auth/login', 'POST', { email: account, password }, undefined, B)).status).toBe(200)
    for (let i = 0; i < 20; i++) expect((await request('/auth/login', 'POST', { email: account, password: 'wrong' }, undefined, A)).status).toBe(401)
    expect((await request('/auth/login', 'POST', { email: account, password }, undefined, A)).status).toBe(429)
    expect((await request('/auth/login', 'POST', { email: account, password }, undefined, B)).status).toBe(200)
  }, 15000)

  it('keeps client B working after client A exhausts the 240/min API limit', async () => {
    await restart()
    const A = forwarded('10.30.0.1'), B = forwarded('10.30.0.2')
    for (let i = 0; i < 240; i++) expect((await request('/auth/me', 'GET', undefined, undefined, A)).status).toBe(401)
    expect((await request('/auth/me', 'GET', undefined, undefined, A)).status).toBe(429)
    expect((await request('/auth/login', 'POST', { email: account, password }, undefined, B)).status).toBe(200)
  }, 30000)

  it('ignores spoofed X-Forwarded-For from an untrusted peer and limits by socket IP', async () => {
    await restart([])
    for (let i = 0; i < 20; i++) expect((await request('/auth/login', 'POST', { email: account, password: 'wrong' }, undefined, forwarded('10.40.0.1'))).status).toBe(401)
    expect((await request('/auth/login', 'POST', { email: account, password }, undefined, forwarded('10.40.0.2'))).status).toBe(429)
    expect(await rawStatus(['X-Forwarded-For: 10.40.0.1', 'x-forwarded-for: 10.40.0.2'])).toBe(401)
  }, 15000)

  it('rejects missing, duplicate and malformed X-Forwarded-For from a trusted peer', async () => {
    await restart()
    const missing = await request('/auth/me')
    expect(missing.status).toBe(400)
    expect(missing.data.error.code).toBe('INVALID_MESSAGE')
    for (const value of ['10.0.0.1, 10.0.0.2', '10.0.0.1:8080', 'client.example.com', '10.0.0.0/8', '[::1]']) {
      const result = await request('/auth/me', 'GET', undefined, undefined, forwarded(value))
      expect(result.status).toBe(400)
      expect(result.data.error.code).toBe('INVALID_MESSAGE')
    }
    expect(await rawStatus(['X-Forwarded-For: 10.0.0.1', 'x-forwarded-for: 10.0.0.2'])).toBe(400)
    expect((await request('/auth/me', 'GET', undefined, undefined, forwarded('10.0.0.9'))).status).toBe(401)
  }, 15000)

  it('shares a rate bucket between IPv4 and IPv4-mapped IPv6 forwarded addresses', async () => {
    await restart(['127.0.0.1'])
    const mapped = forwarded('::ffff:10.50.0.1'), plain = forwarded('10.50.0.1'), other = forwarded('10.50.0.2')
    for (let i = 0; i < 20; i++) expect((await request('/auth/login', 'POST', { email: account, password: 'wrong' }, undefined, mapped)).status).toBe(401)
    expect((await request('/auth/login', 'POST', { email: account, password }, undefined, plain)).status).toBe(429)
    expect((await request('/auth/login', 'POST', { email: account, password }, undefined, other)).status).toBe(200)
  }, 15000)
})

describe('gateway hello timeout and diagnostics', () => {
  it('terminates unresponsive client with HELLO_TIMEOUT error frame and 4001 CONNECTION_FAILED close', async () => {
    await app.close()
    await start(password, [], { helloTimeoutMs: 1000 })
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/v1/connect')
    sockets.push(ws)
    const wire = new Wire(ws)
    await once(ws, 'open')
    const closePromise = once(ws, 'close')

    const errorPayload = await wire.next('error')
    expect(errorPayload).toMatchObject({
      code: 'HELLO_TIMEOUT',
      retryable: true,
    })
    expect(errorPayload.message).toContain('1000ms')

    const [closeCode, closeReason] = await closePromise
    expect(closeCode).toBe(4001)
    expect(closeReason.toString()).toBe('CONNECTION_FAILED')
  })

  it('succeeds handshake when hello arrives within extended hello timeout', async () => {
    await app.close()
    await start(password, [], { helloTimeoutMs: 1000 })
    accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
    const d = await device()
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/v1/connect')
    sockets.push(ws)
    const wire = new Wire(ws)
    await once(ws, 'open')

    // Delay 200ms before sending hello: well inside the 1000ms deadline.
    await new Promise(r => setTimeout(r, 200))
    wire.send('hello', {
      role: d.role,
      deviceId: d.deviceId,
      accessToken: d.accessToken,
      protocols: [1],
      capabilities: ['transport.relay'],
      clientVersion: d.clientVersion,
    })

    const ack = await wire.next('hello.ack')
    expect(ack.protocol).toBe(1)
    expect(ack.heartbeatIntervalMs).toBe(25000)
  })
})

describe('structured logger and sensitive data redaction', () => {
  it('redacts sensitive fields in nested objects and arrays', () => {
    const raw = {
      deviceId: 'dev-1',
      role: 'client',
      accessToken: 'token-secret-123',
      password: 'mypassword',
      refreshToken: 'refresh-secret-456',
      ciphertext: 'opaque-ciphertext-abc',
      sdp: 'v=0\r\no=...',
      headers: {
        authorization: 'Bearer token-secret-789',
        cookie: 'dsh_session=abc123xyz',
        host: 'example.com',
      },
      tokens: [
        { id: 1, token: 'token-in-array' },
        { id: 2, access_token: 'access-token-in-array' },
      ],
    }

    const redacted = redactSensitive(raw) as any
    expect(redacted.deviceId).toBe('dev-1')
    expect(redacted.role).toBe('client')
    expect(redacted.accessToken).toBe('[REDACTED]')
    expect(redacted.password).toBe('[REDACTED]')
    expect(redacted.refreshToken).toBe('[REDACTED]')
    expect(redacted.ciphertext).toBe('[REDACTED]')
    expect(redacted.sdp).toBe('[REDACTED]')
    expect(redacted.headers.host).toBe('example.com')
    expect(redacted.headers.authorization).toBe('[REDACTED]')
    expect(redacted.headers.cookie).toBe('[REDACTED]')
    expect(redacted.tokens[0].token).toBe('[REDACTED]')
    expect(redacted.tokens[1].access_token).toBe('[REDACTED]')
  })

  it('redacts sensitive parameters in URLs and bearer strings', () => {
    const url = 'https://server.example.com/ws/v1/connect?accessToken=secret123&other=safe'
    expect(redactSensitive(url)).toBe('https://server.example.com/ws/v1/connect?accessToken=[REDACTED]&other=safe')

    const bearer = 'Bearer super_secret_token_val== other'
    expect(redactSensitive(bearer)).toBe('Bearer [REDACTED] other')
  })

  it('handles circular references and errors safely', () => {
    const circular: Record<string, unknown> = { key: 'safe' }
    circular.self = circular
    const clean = redactSensitive(circular) as any
    expect(clean.key).toBe('safe')
    expect(clean.self).toBe('[CIRCULAR]')

    const err = new Error('Failed to parse accessToken=secret123')
    const cleanErr = redactSensitive(err) as any
    expect(cleanErr.name).toBe('Error')
    expect(cleanErr.message).toContain('accessToken=[REDACTED]')
  })

  it('emits single-line JSON log entries filtered by log level', () => {
    const entries: LogEntry[] = []
    const lines: string[] = []
    const logger = new Logger('test-scope', 'warn', (line, entry) => {
      lines.push(line)
      entries.push(entry)
    })

    logger.debug('debug_ignored', { info: 'hidden' })
    logger.info('info_ignored', { info: 'hidden' })
    expect(entries).toHaveLength(0)

    logger.warn('warning_logged', {
      user: 'alice',
      accessToken: 'my-token',
    })
    logger.error('error_logged', {
      password: 'pass',
      reason: 'failed',
    })

    expect(entries).toHaveLength(2)
    expect(entries[0].level).toBe('warn')
    expect(entries[0].scope).toBe('test-scope')
    expect(entries[0].event).toBe('warning_logged')
    expect(entries[0].meta.user).toBe('alice')
    expect(entries[0].meta.accessToken).toBe('[REDACTED]')

    expect(entries[1].level).toBe('error')
    expect(entries[1].event).toBe('error_logged')
    expect(entries[1].meta.password).toBe('[REDACTED]')
    expect(entries[1].meta.reason).toBe('failed')

    expect(lines).toHaveLength(2)
    expect(lines[0]).not.toContain('\n')
    const parsed = JSON.parse(lines[0])
    expect(parsed.event).toBe('warning_logged')
    expect(parsed.meta.accessToken).toBe('[REDACTED]')
  })

  it('parses and validates environment configuration with fallback warnings', () => {
    // Hello timeout
    expect(parseHelloTimeout(undefined)).toBe(5000)
    expect(parseHelloTimeout('10000')).toBe(10000)
    expect(parseHelloTimeout('500')).toBe(5000)
    expect(parseHelloTimeout('70000')).toBe(5000)
    expect(parseHelloTimeout('invalid')).toBe(5000)

    // Heartbeat interval
    expect(parseHeartbeatInterval(undefined)).toBe(25000)
    expect(parseHeartbeatInterval('30000')).toBe(30000)
    expect(parseHeartbeatInterval('1000')).toBe(25000)
    expect(parseHeartbeatInterval('150000')).toBe(25000)

    // Heartbeat disconnect
    expect(parseHeartbeatDisconnect(undefined, 25000)).toBe(75000)
    expect(parseHeartbeatDisconnect('80000', 25000)).toBe(80000)
    expect(parseHeartbeatDisconnect('40000', 25000)).toBe(75000)
    expect(parseHeartbeatDisconnect('50000', 30000)).toBe(90000)

    // Log level
    expect(parseLogLevel(undefined)).toBe('info')
    expect(parseLogLevel('debug')).toBe('debug')
    expect(parseLogLevel('WARN')).toBe('warn')
    expect(parseLogLevel('silent')).toBe('silent')
    expect(parseLogLevel('invalid_level')).toBe('info')
  })
})

describe('gateway handshake state machine', () => {
  it('discards a hello that arrives after the deadline without authenticating', async () => {
    await app.close()
    await start(password, [], { helloTimeoutMs: 1000, forceTerminateGraceMs: 200 })
    accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
    const d = await device()
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/v1/connect')
    sockets.push(ws)
    const wire = new Wire(ws)
    await once(ws, 'open')
    const closed = once(ws, 'close')

    expect((await wire.next('error')).code).toBe('HELLO_TIMEOUT')

    // The deadline already fired: this late hello must not authenticate, must
    // not register a peer and must not touch the store.
    await new Promise<void>(resolve => ws.send(JSON.stringify(createControlFrame('hello', {
      role: d.role,
      deviceId: d.deviceId,
      accessToken: d.accessToken,
      protocols: [1],
      capabilities: ['transport.relay'],
      clientVersion: d.clientVersion,
    })), () => resolve()))

    const [closeCode] = await closed
    expect(closeCode).toBe(4001)
    expect(wire.messages.filter(message => message.type === 'hello.ack')).toHaveLength(0)
    expect(app.gateway.peers.has(d.deviceId)).toBe(false)
    expect(app.store.get(d.deviceId).lastSeenAt).toBe(0)
  }, 15000)

  it('keeps a fresh connection authenticated after a timed-out sibling', async () => {
    await app.close()
    await start(password, [], { helloTimeoutMs: 1000 })
    accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
    const d = await device()
    const stalled = new WebSocket(base.replace('http:', 'ws:') + '/ws/v1/connect')
    sockets.push(stalled)
    await once(stalled, 'open')
    const closed = once(stalled, 'close')

    const live = await socket(d)
    expect((await live.next('hello.ack')).protocol).toBe(1)
    await closed
    expect(app.gateway.peers.get(d.deviceId)).toBeDefined()
    live.send('ping', { nonce: 'still-authenticated' })
    expect(await live.next('pong')).toEqual({ nonce: 'still-authenticated' })
  }, 15000)
})

describe('gateway timing configuration normalization', () => {
  it('maps NaN, Infinity and out-of-range programmatic values to safe defaults', () => {
    expect(normalizeGatewayOptions({})).toEqual({
      helloTimeoutMs: 5000, heartbeatIntervalMs: 25000, heartbeatDisconnectMs: 75000, forceTerminateGraceMs: 1000,
    })
    expect(normalizeGatewayOptions({
      helloTimeoutMs: Number.NaN,
      heartbeatIntervalMs: Number.POSITIVE_INFINITY,
      heartbeatDisconnectMs: -1,
      forceTerminateGraceMs: 0,
    })).toEqual({
      helloTimeoutMs: 5000, heartbeatIntervalMs: 25000, heartbeatDisconnectMs: 75000, forceTerminateGraceMs: 1000,
    })
    expect(normalizeGatewayOptions({ helloTimeoutMs: 59 }).helloTimeoutMs).toBe(5000)
    expect(normalizeGatewayOptions({ helloTimeoutMs: 60001 }).helloTimeoutMs).toBe(5000)
    expect(normalizeGatewayOptions({ helloTimeoutMs: '2500' as unknown as number }).helloTimeoutMs).toBe(2500)
    expect(normalizeGatewayOptions({ heartbeatIntervalMs: 300_000 }).heartbeatIntervalMs).toBe(25000)
    expect(normalizeGatewayOptions({ forceTerminateGraceMs: 50 }).forceTerminateGraceMs).toBe(1000)
    expect(normalizeGatewayOptions({ forceTerminateGraceMs: 10001 }).forceTerminateGraceMs).toBe(1000)
  })

  it('keeps the disconnect threshold at twice the interval and inside its ceiling', () => {
    expect(normalizeGatewayOptions({ heartbeatIntervalMs: 30000 }).heartbeatDisconnectMs).toBe(90000)
    expect(normalizeGatewayOptions({ heartbeatIntervalMs: 30000, heartbeatDisconnectMs: 59000 }).heartbeatDisconnectMs).toBe(90000)
    expect(normalizeGatewayOptions({ heartbeatIntervalMs: 30000, heartbeatDisconnectMs: 60001 }).heartbeatDisconnectMs).toBe(60001)
    expect(normalizeGatewayOptions({ heartbeatIntervalMs: 30000, heartbeatDisconnectMs: 600_001 }).heartbeatDisconnectMs).toBe(90000)
    expect(normalizeGatewayOptions({ heartbeatIntervalMs: 120_000 }).heartbeatDisconnectMs).toBe(360_000)
  })

  it('normalizes unsafe values handed to createRemoteServer', () => {
    const unsafe = createRemoteServer({
      account, password, dataFile: join(dir, 'unsafe.json'), publicUrl: 'http://localhost:8080',
      helloTimeoutMs: Number.NaN, heartbeatIntervalMs: Number.POSITIVE_INFINITY,
      heartbeatDisconnectMs: -1, forceTerminateGraceMs: Number.NaN,
    })
    try {
      expect(unsafe.gateway.helloTimeoutMs).toBe(5000)
      expect(unsafe.gateway.heartbeatIntervalMs).toBe(25000)
      expect(unsafe.gateway.heartbeatDisconnectMs).toBe(75000)
      expect(unsafe.gateway.forceTerminateGraceMs).toBe(1000)
    } finally {
      unsafe.gateway.close()
    }
  })

  it('never echoes the rejected value in a configuration warning', () => {
    const warnings: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => { warnings.push(String(message)) })
    try {
      expect(parseHelloTimeout('not-a-number-CANARY7')).toBe(5000)
      expect(parseHeartbeatInterval('CANARY7')).toBe(25000)
      expect(parseHeartbeatDisconnect('CANARY7', 25000)).toBe(75000)
      expect(parseLogLevel('CANARY7')).toBe('info')
    } finally {
      spy.mockRestore()
    }
    expect(warnings).toHaveLength(4)
    for (const warning of warnings) expect(warning).not.toContain('CANARY7')
    expect(warnings[0]).toContain('1000 and 60000')
  })
})

describe('defensive logger hardening', () => {
  it('redacts secrets inside serialized JSON documents and URLs', () => {
    const document = JSON.stringify({
      access_token: 'CANARY-A', sdp: 'v=0 o=alice 1234', nested: { refreshToken: 'CANARY-B' }, keep: 'visible',
    })
    const redacted = redactSensitive(document) as string
    expect(redacted).not.toContain('CANARY-A')
    expect(redacted).not.toContain('CANARY-B')
    expect(redacted).not.toContain('v=0')
    expect(redacted).toContain('visible')
    expect(redacted).toContain('[REDACTED]')
    expect(redactSensitive('wss://host/ws?token=CANARY-C&sdp=CANARY-D&keep=1'))
      .toBe('wss://host/ws?token=[REDACTED]&sdp=[REDACTED]&keep=1')
    // Scheme prefixes must be handled before the generic key/value rule.
    expect(redactSensitive('Authorization: Bearer CANARY-TOKEN')).not.toContain('CANARY-TOKEN')
    expect(redactSensitive('basic CANARY-BASIC')).not.toContain('CANARY-BASIC')
  })

  it('redacts ciphertext, cookie and authorization keys in every spelling', () => {
    const clean = redactSensitive({
      'x-ciphertext': 'CANARY-E',
      cipher_text: 'CANARY-F',
      cookie: 'CANARY-G',
      authorization: 'CANARY-H',
      'refresh-token': 'CANARY-I',
      secret: 'CANARY-J',
      sibling: 'kept',
    }) as Record<string, string>
    for (const key of Object.keys(clean)) {
      if (key === 'sibling') expect(clean[key]).toBe('kept')
      else expect(clean[key]).toBe('[REDACTED]')
    }
  })

  it('never throws on BigInt, NaN, throwing getters or hostile proxies', () => {
    const entries: LogEntry[] = []
    const logger = new Logger('test-scope', 'debug', (_line, entry) => entries.push(entry))
    const withGetter = { ok: 'fine', get boom(): string { throw new Error('getter exploded') } }
    const hostile = new Proxy({}, {
      ownKeys() { throw new Error('blocked') },
      getOwnPropertyDescriptor() { throw new Error('blocked') },
      get() { throw new Error('blocked') },
    })

    expect(() => logger.info('bigint_logged', { size: 9007199254740993n, ratio: Number.NaN, list: [1n, 2n] })).not.toThrow()
    expect(() => logger.warn('getter_logged', withGetter as unknown as Record<string, unknown>)).not.toThrow()
    expect(() => logger.error('hostile_logged', hostile as Record<string, unknown>)).not.toThrow()

    expect(entries[0].meta.size).toBe('9007199254740993')
    expect(entries[0].meta.ratio).toBe('NaN')
    expect(entries[0].meta.list).toEqual(['1', '2'])
    expect(entries[1].meta.ok).toBe('fine')
    expect(entries[1].meta.boom).toBe('[UNSERIALIZABLE]')
    expect(entries[2].meta).toEqual({ value: '[UNSERIALIZABLE]' })
    for (const entry of entries) expect(() => JSON.stringify(entry)).not.toThrow()
  })

  it('replaces unsanitized event and scope labels', () => {
    const entries: LogEntry[] = []
    const logger = new Logger('bad scope {"injected":true}', 'info', (_line, entry) => entries.push(entry))
    logger.info('event with spaces {"leak":1}', { ok: 1 })
    expect(entries[0].scope).toBe('server')
    expect(entries[0].event).toBe('invalid_event')
    expect(entries[0].meta).toEqual({ ok: 1 })
  })

  it('rejects prototype members when parsing log levels', () => {
    const warnings: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => { warnings.push(String(message)) })
    try {
      for (const candidate of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
        expect(parseLogLevel(candidate)).toBe('info')
      }
      expect(parseLogLevel('constructor', 'warn')).toBe('warn')
    } finally {
      spy.mockRestore()
    }
    expect(warnings.join('\n')).not.toContain('__proto__')
  })
})

describe('gateway diagnostics redaction', () => {
  it('never logs query parameters from a rejected upgrade', async () => {
    const lines: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => { lines.push(String(message)) })
    try {
      const port = (app.server.address() as { port: number }).port
      const crlf = String.fromCharCode(13, 10)
      await new Promise<void>(resolve => {
        const socket = createConnection(port, '127.0.0.1')
        socket.on('connect', () => socket.write([
          'GET /ws/v1/connect?access_token=CANARY-URL HTTP/1.1',
          `Host: 127.0.0.1:${port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version: 13',
          '',
          '',
        ].join(crlf)))
        socket.on('data', () => {})
        socket.on('close', () => resolve())
        socket.on('error', () => resolve())
      })
    } finally {
      spy.mockRestore()
    }
    const log = lines.join('\n')
    expect(log).toContain('ws_upgrade_rejected')
    expect(log).toContain('invalid_url')
    expect(log).not.toContain('CANARY-URL')
    expect(log).not.toContain('access_token')
  })

  it('never logs credentials from a rejected hello', async () => {
    const lines: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => { lines.push(String(message)) })
    try {
      const wire = await socket(await device(), { accessToken: 'CANARY-HELLO' })
      expect((await wire.next('error')).code).toBe('AUTH_INVALID')
    } finally {
      spy.mockRestore()
    }
    expect(lines.join('\n')).toContain('ws_message_error')
    expect(lines.join('\n')).not.toContain('CANARY-HELLO')
  })

  it('never logs a client-supplied close reason', async () => {
    await app.close()
    await start(password, [], { logLevel: 'debug' })
    accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
    const d = await device()
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/v1/connect')
    sockets.push(ws)
    const wire = new Wire(ws)
    await once(ws, 'open')
    wire.send('hello', {
      role: d.role, deviceId: d.deviceId, accessToken: d.accessToken,
      protocols: [1], capabilities: ['transport.relay'], clientVersion: d.clientVersion,
    })
    await wire.next('hello.ack')

    const lines: string[] = []
    const spy = vi.spyOn(console, 'info').mockImplementation((message: unknown) => { lines.push(String(message)) })
    try {
      const closed = once(ws, 'close')
      ws.close(4000, 'CANARY-REASON')
      await closed
      await new Promise(resolve => setTimeout(resolve, 50))
    } finally {
      spy.mockRestore()
    }
    const log = lines.join('\n')
    expect(log).toContain('ws_connection_closed')
    expect(log).toContain('"hasReason":true')
    expect(log).not.toContain('CANARY-REASON')
  })
})
