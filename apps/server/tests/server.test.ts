import { runScenarios, scenarioName } from '../../../scripts/test-scenarios.mjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createConnection } from 'node:net'
import { WebSocket } from 'ws'
import { MAX_CONTROL_FRAME_BYTES, createControlFrame } from '@dsh-remote/protocol'
import { NoiseIkSession, createNoisePrologue, generateKeyPair, toBase64Url, fromBase64Url } from '../../../packages/crypto/src/index.js'
import { RelayTransport } from '../../../packages/webrtc/src/index.js'
import { ClientSecureTransport } from '../../../packages/plugin/src/client-secure-transport.js'
import { createRemoteServer, normalizeIp, normalizeTrustedProxyIps } from '../src/server.js'

const account = 'owner@example.com', password = 'local-test-password'
let app: ReturnType<typeof createRemoteServer>, dir: string, base: string, accountToken: string
const sockets: WebSocket[] = []
const secureClients: ClientSecureTransport[] = []
const noiseSessions: NoiseIkSession[] = []
async function request(path: string, method = 'GET', body?: unknown, token?: string, headers = {}) {
  const response = await fetch(`${base}/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, data: await response.json(), headers: response.headers }
}
async function start(pass = password, trustedProxyIps: readonly string[] = []) {
  app = createRemoteServer({ account, password: pass, dataFile: join(dir, 'state.json'), publicUrl: 'http://localhost:8080', trustedProxyIps })
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
async function socket(d: Awaited<ReturnType<typeof device>>, overrides = {}) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws/v1/connect'); sockets.push(ws)
  const wire = new Wire(ws); await once(ws, 'open')
  wire.send('hello', { role: d.role, deviceId: d.deviceId, accessToken: d.accessToken, protocols: [1], capabilities: ['transport.relay', 'transport.p2p'], clientVersion: d.clientVersion, ...overrides })
  return wire
}
async function connection() {
  const h = await device('host'), c = await device(), host = await socket(h), client = await socket(c)
  expect(await host.next('hello.ack')).toMatchObject({ capabilities: ['transport.relay'], webrtcEnabled: false })
  await client.next('hello.ack')
  client.send('connect.request', { hostDeviceId: h.deviceId, preferredTransports: ['relay'] })
  const incoming = await host.next('connect.incoming')
  expect(incoming.clientIdentityKey).toBe(c.identityKey)
  host.send('connect.accepted', { connectionId: incoming.connectionId })
  const { connectionId } = await client.next('connect.accepted')
  return { h, c, host, client, connectionId }
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
  it('persists credentials as digests, rotates refresh tokens and revokes a reused family', async () => {
    const d = await device()
    const saved = readFileSync(join(dir, 'state.json'), 'utf8')
    expect(saved).not.toContain(d.refreshToken); expect(saved).not.toContain(d.accessToken); expect(saved).not.toContain(password)
    await app.close(); await start()
    expect((await request('/devices', 'GET', undefined, d.accessToken)).status).toBe(200)
    const rotated = await request('/auth/refresh', 'POST', { deviceId: d.deviceId, refreshToken: d.refreshToken })
    expect(rotated.status).toBe(200)
    expect(rotated.data.refreshTokenExpiresAt).toBe(d.refreshTokenExpiresAt)
    expect((await request('/auth/refresh', 'POST', { deviceId: d.deviceId, refreshToken: d.refreshToken })).status).toBe(401)
    expect((await request('/devices', 'GET', undefined, rotated.data.accessToken)).status).toBe(401)
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
