import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { RemoteClientCore } from '@dsh-remote/client-core'
import { generateKeyPair } from '@dsh-remote/crypto'
import { PROTOCOL_VERSION } from '@dsh-remote/protocol'
import { RelayTransport } from '@dsh-remote/webrtc'
import { SecureTransport } from '../../apps/android/src/services/secure-transport'
import type { DeviceIdentity, RemoteDevice } from '../../apps/android/src/types'

const baseUrl = (process.env.DSH_REMOTE_HTTP_SERVER ?? 'http://127.0.0.1:8080').replace(/\/$/, '')
const email = process.env.DSH_REMOTE_ACCOUNT_EMAIL
const password = process.env.DSH_REMOTE_ACCOUNT_PASSWORD
if (email === undefined || password === undefined) {
  throw new Error('DSH_REMOTE_ACCOUNT_EMAIL and DSH_REMOTE_ACCOUNT_PASSWORD are required')
}

Object.assign(globalThis, { WebSocket })

const clientKeys = generateKeyPair()
const identity: DeviceIdentity = {
  deviceId: randomUUID(),
  name: 'Android smoke client',
  platform: 'android',
  ...clientKeys,
}

// Account authorization: log in, then register this client under the account.
const login = await request<{ token: string; account: string }>('/api/v1/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
})
const registration = await request<{ accessToken: string }>('/api/v1/devices/register', {
  method: 'POST',
  body: JSON.stringify({
    v: PROTOCOL_VERSION,
    device: {
      deviceId: identity.deviceId,
      name: identity.name,
      role: 'client',
      platform: identity.platform,
      identityKey: identity.publicKey,
      clientVersion: '0.5.21',
    },
  }),
}, login.token)
const accessToken = registration.accessToken

// Membership device list + authorized peer descriptor for identity pinning.
const hosts = await request<{ items: Array<{ deviceId: string; membershipId: string }> }>('/api/v1/devices', {}, accessToken)
// Prefer an online host via the presence endpoint; the list view has no online flag.
let hostId = process.env.DSH_REMOTE_HOST_DEVICE_ID
if (hostId === undefined) {
  for (const item of hosts.items) {
    const presence = await request<{ online?: boolean }>(`/api/v1/devices/${encodeURIComponent(item.deviceId)}/presence`, {}, accessToken)
    if (presence.online === true) { hostId = item.deviceId; break }
  }
  hostId ??= hosts.items[0]?.deviceId
}
if (hostId === undefined) throw new Error('No host devices in this account')
const descriptor = await request<{
  deviceId: string
  role: string
  identityKey: string
  membershipId: string
}>(`/api/v1/devices/${encodeURIComponent(hostId)}`, {}, accessToken)
if (descriptor.role !== 'host' || descriptor.identityKey.length === 0) {
  throw new Error('The selected device is not an authorized Host')
}
const host: RemoteDevice = {
  deviceId: descriptor.deviceId,
  name: descriptor.deviceId,
  platform: 'linux',
  identityKey: descriptor.identityKey,
  membershipId: descriptor.membershipId,
  online: true,
  trusted: true,
}

const wsUrl = new URL('/ws/v1/connect', baseUrl)
wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'
const relay = new RelayTransport(wsUrl.toString(), {
  role: 'client',
  deviceId: identity.deviceId,
  accessToken,
  targetDeviceId: host.deviceId,
  capabilities: ['transport.relay', 'harness.api.v1'],
  preferredTransports: ['relay'],
})
const secure = new SecureTransport(relay, identity, host)
const client = new RemoteClientCore(secure, 10_000)
const muxFrames: Array<{ type: string; rpcId?: string }> = []
let muxClosed = false
client.onEvent(event => {
  if (event.event === 'harness.api.frame') {
    // Mux frames nest harness event types (e.g. assistant/chunk) under
    // payload.event.type, matching the plugin bridge and the Android reducer.
    const data = event.data as { frame?: { rpcId?: string; payload?: { type?: string; event?: { type?: string } } } }
    const type = data.frame?.payload?.event?.type ?? data.frame?.payload?.type
    if (type !== undefined) muxFrames.push({ type, rpcId: data.frame?.rpcId })
  }
  if (event.event === 'harness.api.stream.closed') muxClosed = true
})
await client.connect()

// Open the mux stream through the ApiProxy tunnel.
const streamId = randomUUID()
const open = await client.rpc<{ opened: boolean }>('harness.api.stream.open', {
  streamId,
  stream: 'mux',
  rpcId: randomUUID(),
  payload: {},
})
if (!open.opened) throw new Error('Mux stream did not open')

// Unary ApiProxy call with native rpcId echo.
const listRpcId = randomUUID()
const list = await client.rpc<{ rpcId: string; result: { ok: boolean; value?: unknown } }>('harness.api.call', {
  method: 'session.list',
  rpcId: listRpcId,
  payload: {},
})
if (list.rpcId !== listRpcId || !list.result.ok) throw new Error('session.list failed')

// Prompt and wait for the mux frames the mock host emits.
const promptRpcId = randomUUID()
const prompt = await client.rpc<{ rpcId: string; result: { ok: boolean; value?: unknown } }>('harness.api.call', {
  method: 'session.prompt',
  rpcId: promptRpcId,
  payload: { sessionId: 's1', mode: 'queue', content: [{ type: 'text', text: 'Android encrypted smoke test' }] },
})
if (!prompt.result.ok) throw new Error('session.prompt failed')

const deadline = Date.now() + 8_000
while (!muxFrames.some(frame => frame.type === 'approval/requested') && Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 100))
}
if (!muxFrames.some(frame => frame.type === 'assistant/chunk')) throw new Error('No streaming event received')
const approval = muxFrames.find(frame => frame.type === 'approval/requested')
if (approval === undefined) throw new Error('No approval request received')

// Answer the approval with the native client-response envelope.
await client.rpc('harness.api.respond', {
  message: {
    type: 'client-response',
    rpcId: approval.rpcId ?? '',
    result: { ok: true, value: { sessionId: 's1', approvalId: 'approval-1', outcome: 'rejected' } },
  },
})

await client.rpc('harness.api.stream.close', { streamId })
await client.close()
console.log(JSON.stringify({
  accountAuthorized: true,
  encryptedRelay: true,
  muxOpened: open.opened,
  sessionsListed: true,
  frames: muxFrames.map(frame => frame.type),
}))

async function request<TResult>(path: string, init: RequestInit = {}, token?: string): Promise<TResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...init.headers,
    },
  })
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${await response.text()}`)
  return response.json() as Promise<TResult>
}
