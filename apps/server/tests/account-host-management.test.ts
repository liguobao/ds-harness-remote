import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { MAX_DEVICE_NAME_LENGTH, createControlFrame } from '@dsh-remote/protocol'
import { generateKeyPair } from '../../../packages/crypto/src/index.js'
import { createRemoteServer } from '../src/server.js'

const account = 'owner@example.com'
const password = 'local-test-password'
const fullCapabilities = ['transport.lan', 'transport.p2p', 'transport.turn', 'transport.relay']

interface RegisteredDevice {
  deviceId: string
  identityKey: string
  name: string
  role: 'host' | 'client'
  platform: string
  clientVersion: string
  accessToken: string
  refreshToken: string
}

describe('account host management via Web session and client device tokens', () => {
  let app: ReturnType<typeof createRemoteServer>
  let dir: string
  let base: string
  let accountToken: string
  const sockets: WebSocket[] = []

  async function start() {
    app = createRemoteServer({
      account,
      password,
      dataFile: join(dir, 'state.json'),
      publicUrl: 'http://localhost:8080',
    })
    app.server.listen(0, '127.0.0.1')
    await once(app.server, 'listening')
    base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`
  }

  async function request(path: string, method = 'GET', body?: unknown, token?: string) {
    const response = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, data: await response.json() as any }
  }

  async function registerDevice(
    role: 'host' | 'client',
    overrides: Partial<{ deviceId: string; name: string; platform: string; clientVersion: string; harnessVersion: string }> = {},
  ): Promise<RegisteredDevice> {
    const keys = generateKeyPair()
    const descriptor = {
      deviceId: overrides.deviceId ?? randomUUID(),
      identityKey: keys.publicKey,
      name: overrides.name ?? `test-${role}`,
      role,
      platform: overrides.platform ?? 'linux',
      clientVersion: overrides.clientVersion ?? '0.6.9',
      ...(overrides.harnessVersion !== undefined ? { harnessVersion: overrides.harnessVersion } : {}),
    }
    const result = await request('/devices/register', 'POST', { v: 1, device: descriptor }, accountToken)
    expect(result.status).toBe(200)
    return { ...descriptor, accessToken: result.data.accessToken, refreshToken: result.data.refreshToken }
  }

  async function connectControlSocket(d: RegisteredDevice, harnessVersion?: string): Promise<WebSocket> {
    const ws = new WebSocket(`${base.replace('http:', 'ws:')}/ws/v1/connect`)
    sockets.push(ws)
    const ackPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('hello.ack timed out')), 3000)
      ws.on('message', raw => {
        const frame = JSON.parse(raw.toString()) as { type?: string }
        if (frame.type === 'hello.ack') {
          clearTimeout(timer)
          resolve()
        }
      })
    })
    await once(ws, 'open')
    ws.send(JSON.stringify(createControlFrame('hello', {
      role: d.role,
      deviceId: d.deviceId,
      accessToken: d.accessToken,
      protocols: [1],
      capabilities: fullCapabilities,
      clientVersion: d.clientVersion,
      ...(harnessVersion !== undefined ? { harnessVersion } : {}),
    })))
    await ackPromise
    return ws
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-server-host-mgmt-'))
    await start()
    accountToken = (await request('/auth/login', 'POST', { email: account, password })).data.token
  })

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate()
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('allows an authorized client device to rename and revoke offline or online hosts while protecting client devices', async () => {
    const caller = await registerDevice('client')
    const peerClient = await registerDevice('client')
    const offlineHost = await registerDevice('host', { name: 'MASO3185', platform: 'win32', harnessVersion: '1.0.0-rc.1' })
    const onlineHost = await registerDevice('host', { name: 'MASO3185', platform: 'win32', harnessVersion: '1.0.0-rc.5' })
    const onlineWs = await connectControlSocket(onlineHost, '1.0.0-rc.5')

    // Host tokens, self-targeting client tokens, and peer-client targets require a Web account session.
    expect((await request(`/account/devices/${offlineHost.deviceId}`, 'PATCH', { name: 'denied' }, onlineHost.accessToken)).status).toBe(401)
    expect((await request(`/account/devices/${caller.deviceId}`, 'PATCH', { name: 'self' }, caller.accessToken)).status).toBe(401)
    expect((await request(`/account/devices/${peerClient.deviceId}`, 'PATCH', { name: 'peer' }, caller.accessToken)).status).toBe(401)
    expect((await request(`/account/devices/${caller.deviceId}`, 'DELETE', undefined, caller.accessToken)).status).toBe(401)
    expect((await request(`/account/devices/${peerClient.deviceId}`, 'DELETE', undefined, caller.accessToken)).status).toBe(401)
    expect((await request(`/account/devices/${onlineHost.deviceId}`, 'DELETE', undefined, onlineHost.accessToken)).status).toBe(401)
    expect((await request('/account/devices/%E0%A4%A', 'DELETE', undefined, caller.accessToken)).status).toBe(400)

    // Multi-byte UTF-8 names obey MAX_DEVICE_NAME_LENGTH (128 UTF-8 bytes) so state.json reloads cleanly after restart.
    const tooManyUtf8Bytes = '机'.repeat(Math.floor(MAX_DEVICE_NAME_LENGTH / 3) + 1)
    const oversize = await request(`/account/devices/${encodeURIComponent(offlineHost.deviceId)}`, 'PATCH', { name: tooManyUtf8Bytes }, caller.accessToken)
    expect(oversize.status).toBe(400)
    expect(oversize.data.error.code).toBe('INVALID_MESSAGE')

    const renamed = await request(`/account/devices/${encodeURIComponent(offlineHost.deviceId)}`, 'PATCH', { name: '  书房旧主机  ' }, caller.accessToken)
    expect(renamed.status).toBe(200)
    expect(renamed.data.name).toBe('书房旧主机')

    // Removing the retired offline Host revokes it on the Server while keeping the caller phone signed in.
    const removedOffline = await request(`/account/devices/${encodeURIComponent(offlineHost.deviceId)}`, 'DELETE', undefined, caller.accessToken)
    expect(removedOffline.status).toBe(200)
    expect(removedOffline.data.status).toBe('revoked')
    expect((await request('/me', 'GET', undefined, caller.accessToken)).status).toBe(200)

    const remaining = await request('/devices', 'GET', undefined, caller.accessToken)
    expect(remaining.status).toBe(200)
    expect(remaining.data.items.map((item: { deviceId: string }) => item.deviceId)).toEqual([onlineHost.deviceId])

    // Removing an online Host from a client drops its active control socket and blocks refresh.
    const closed = once(onlineWs, 'close')
    const removedOnline = await request(`/account/devices/${onlineHost.deviceId}`, 'DELETE', undefined, caller.accessToken)
    expect(removedOnline.status).toBe(200)
    const [closeCode, closeReason] = await closed
    expect(closeCode).toBe(4001)
    expect(closeReason.toString()).toBe('AUTH_INVALID')
    expect((await request('/auth/refresh', 'POST', { deviceId: onlineHost.deviceId, refreshToken: onlineHost.refreshToken })).data.error.code).toBe('DEVICE_REVOKED')

    // Restarting the Server cleanly reloads persisted state.json.
    await app.close()
    await start()
    expect((await request('/devices', 'GET', undefined, caller.accessToken)).data.items).toEqual([])
  })

  it('updates an existing host version in place across upgrades without creating duplicate offline entries', async () => {
    const keys = generateKeyPair()
    const hostId = randomUUID()
    const initial = await request('/devices/register', 'POST', {
      v: 1,
      device: {
        deviceId: hostId,
        identityKey: keys.publicKey,
        name: 'MASO3185',
        role: 'host',
        platform: 'win32',
        clientVersion: '0.6.4',
        harnessVersion: '1.0.0-rc.1',
      },
    }, accountToken)
    expect(initial.status).toBe(200)

    const upgraded = await request('/devices/register', 'POST', {
      v: 1,
      device: {
        deviceId: hostId,
        identityKey: keys.publicKey,
        name: 'MASO3185',
        role: 'host',
        platform: 'win32',
        clientVersion: '0.6.9',
        harnessVersion: '1.0.0-rc.5',
      },
    }, accountToken)
    expect(upgraded.status).toBe(200)

    await connectControlSocket({
      deviceId: hostId,
      identityKey: keys.publicKey,
      name: 'MASO3185',
      role: 'host',
      platform: 'win32',
      clientVersion: '0.6.9',
      accessToken: upgraded.data.accessToken,
      refreshToken: upgraded.data.refreshToken,
    }, '1.0.0-rc.5')

    const caller = await registerDevice('client')
    const listed = await request('/devices', 'GET', undefined, caller.accessToken)
    expect(listed.status).toBe(200)
    expect(listed.data.items).toHaveLength(1)
    expect(listed.data.items[0]).toMatchObject({
      deviceId: hostId,
      name: 'MASO3185',
      online: true,
      clientVersion: '0.6.9',
      harnessVersion: '1.0.0-rc.5',
    })
  })
})
