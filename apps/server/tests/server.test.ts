import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { createControlFrame } from '@dsh-remote/protocol'
import { NoiseIkSession, createNoisePrologue, generateKeyPair, toBase64Url, fromBase64Url } from '../../../packages/crypto/src/index.js'
import { createRemoteServer } from '../src/server.js'

const account = 'owner@example.com', password = 'local-test-password'
let app: ReturnType<typeof createRemoteServer>, dir: string, base: string, accountToken: string
const sockets: WebSocket[] = []
async function request(path: string, method = 'GET', body?: unknown, token?: string, headers = {}) {
  const response = await fetch(`${base}/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, data: await response.json(), headers: response.headers }
}
async function start(pass = password) {
  app = createRemoteServer({ account, password: pass, dataFile: join(dir, 'state.json'), publicUrl: 'http://localhost:8080' })
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening')
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`
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
  client.send('secure.handshake', { connectionId, targetDeviceId: h.deviceId, step: 1, data: toBase64Url(initiator.writeHandshake()) })
  responder.readHandshake(fromBase64Url((await host.next('secure.handshake')).data))
  host.send('secure.handshake', { connectionId, targetDeviceId: c.deviceId, step: 2, data: toBase64Url(responder.writeHandshake()) })
  initiator.readHandshake(fromBase64Url((await client.next('secure.handshake')).data))
  return { initiator, responder }
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-server-')); await start()
  accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
})
afterEach(async () => { for (const ws of sockets.splice(0)) ws.terminate(); await app.close(); rmSync(dir, { recursive: true, force: true }) })

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
  it.each(['wrong-target', 'third-device', 'before-handshake'])('rejects unauthorized relay: %s', async reason => {
    const ctx = await connection()
    const attacker = reason === 'third-device' ? await socket(await device()) : ctx.client
    if (reason === 'third-device') await attacker.next('hello.ack')
    attacker.send('relay', { connectionId: ctx.connectionId, targetDeviceId: reason === 'wrong-target' ? randomUUID() : ctx.h.deviceId, counter: 0, ciphertext: 'opaque' })
    expect((await attacker.next('error')).code).toMatch(/CONNECTION_NOT_FOUND|INVALID_MESSAGE/)
    expect(ctx.host.messages.filter(m => m.type === 'relay')).toHaveLength(0)
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
describe('health and readiness endpoints', () => {
  it('serves health, healthz, and ready without authentication or rate limiting', async () => {
    for (const path of ['/health', '/healthz', '/ready']) {
      const response = await fetch(`${base}${path}`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'ok' })
    }
  })
})
