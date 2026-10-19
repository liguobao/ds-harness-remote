import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import {
  NoiseIkSession,
  createNoisePrologue,
  fromBase64Url,
  generateKeyPair,
  toBase64Url,
} from '@dsh-remote/crypto'
import {
  PROTOCOL_VERSION,
  createControlFrame,
  createMessage,
  createRpcError,
  createRpcResponse,
  decodeMessage,
  encodeMessage,
  parseControlFrame,
  type ConnectIncomingPayload,
  type DeviceDescriptor,
  type RelayPayload,
  type RemoteMessage,
  type RpcErrorPayload,
  type RpcRequestPayload,
  type SecureHandshakePayload,
} from '@dsh-remote/protocol'

const server = process.env.DSH_REMOTE_SERVER ?? 'ws://127.0.0.1:8080/ws/v1/connect'
const deviceId = process.env.DSH_REMOTE_DEVICE_ID ?? randomUUID()
const email = process.env.DSH_REMOTE_ACCOUNT_EMAIL
const password = process.env.DSH_REMOTE_ACCOUNT_PASSWORD
const keyPair = generateKeyPair()
const trustedPeers = new Map<string, string>()
const connections = new Map<string, {
  clientDeviceId: string
  noise: NoiseIkSession
}>()
const streams = new Map<string, { connectionId: string; stream: 'mux' | 'host' }>()
const respondable = new Map<string, string>()
const sessions = [
  {
    sessionId: 's1',
    updatedAt: Date.now(),
    running: false,
    blank: false,
    cwd: '~/Projects/foo',
  },
]

const accessToken = process.env.DSH_REMOTE_TOKEN ?? (await registerDevice()).accessToken
const socket = new WebSocket(server)

socket.on('open', () => {
  sendControl('hello', {
    role: 'host',
    deviceId,
    accessToken,
    protocols: [PROTOCOL_VERSION],
    clientVersion: '0.5.13',
    capabilities: ['transport.relay', 'harness.api.v1'],
  })
})

socket.on('message', raw => {
  void handleControl(raw.toString()).catch(error => {
    console.error(`[mock-host] ${error instanceof Error ? error.message : 'invalid control frame'}`)
    socket.close(1008, 'protocol error')
  })
})

socket.on('close', () => console.log('[mock-host] disconnected'))
socket.on('error', error => console.error(`[mock-host] websocket error: ${error.message}`))

async function handleControl(raw: string): Promise<void> {
  const frame = parseControlFrame(JSON.parse(raw))
  if (frame.type === 'hello.ack') {
    console.log(`[mock-host] connected to ${server}`)
    return
  }
  if (frame.type === 'connect.incoming') {
    await acceptConnection(frame.payload)
    return
  }
  if (frame.type === 'secure.handshake') {
    handleHandshake(frame.payload)
    return
  }
  if (frame.type === 'relay') {
    await handleRelay(frame.payload)
    return
  }
  if (frame.type === 'ping') sendControl('pong', frame.payload)
  if (frame.type === 'error') {
    const payload = asRecord(frame.payload)
    throw new Error(typeof payload.message === 'string' ? payload.message : 'Server returned a control error')
  }
}

async function acceptConnection(value: unknown): Promise<void> {
  const payload = value as Partial<ConnectIncomingPayload>
  if (typeof payload.connectionId !== 'string'
    || typeof payload.clientDeviceId !== 'string'
    || typeof payload.clientIdentityKey !== 'string') {
    throw new Error('Invalid connect.incoming payload')
  }
  if (payload.authorization !== 'account') {
    sendControl('connect.rejected', {
      connectionId: payload.connectionId,
      code: 'ACCOUNT_AUTH_REQUIRED',
      message: 'Mock Host only accepts account-authorized connections.',
    })
    return
  }
  if (!payload.preferredTransports?.includes('relay')) {
    sendControl('connect.rejected', {
      connectionId: payload.connectionId,
      targetDeviceId: payload.clientDeviceId,
      code: 'NO_COMMON_TRANSPORT',
      message: 'Mock Host supports Relay only.',
    })
    return
  }
  // Cross-check the client descriptor through the same membership-protected
  // device endpoint the plugin uses, then pin the identity key.
  const descriptor = await apiRequest<{
    deviceId?: unknown
    role?: unknown
    membershipId?: unknown
    identityKey?: unknown
  }>(`/api/v1/devices/${encodeURIComponent(payload.clientDeviceId)}`)
  if (descriptor.role !== 'client'
    || descriptor.deviceId !== payload.clientDeviceId
    || descriptor.identityKey !== payload.clientIdentityKey
    || typeof descriptor.membershipId !== 'string' || descriptor.membershipId.length === 0) {
    sendControl('connect.rejected', {
      connectionId: payload.connectionId,
      code: 'PEER_IDENTITY_MISMATCH',
      message: 'Client descriptor does not match the connect event.',
    })
    return
  }
  const existing = trustedPeers.get(payload.clientDeviceId)
  if (existing !== undefined && existing !== payload.clientIdentityKey) {
    sendControl('connect.rejected', {
      connectionId: payload.connectionId,
      code: 'PEER_IDENTITY_MISMATCH',
      message: 'Client identity key changed for a pinned device.',
    })
    return
  }
  trustedPeers.set(payload.clientDeviceId, payload.clientIdentityKey)
  connections.set(payload.connectionId, {
    clientDeviceId: payload.clientDeviceId,
    noise: new NoiseIkSession({
      role: 'responder',
      localPrivateKey: keyPair.privateKey,
      localPublicKey: keyPair.publicKey,
      remotePublicKey: payload.clientIdentityKey,
      prologue: createNoisePrologue(payload.connectionId, deviceId, payload.clientDeviceId),
    }),
  })
  sendControl('connect.accepted', { connectionId: payload.connectionId })
  console.log(`[mock-host] accepted client ${payload.clientDeviceId}`)
}

function handleHandshake(value: unknown): void {
  const payload = value as Partial<SecureHandshakePayload>
  const connectionId = payload.connectionId
  const connection = typeof connectionId === 'string' ? connections.get(connectionId) : undefined
  if (typeof connectionId !== 'string'
    || connection === undefined
    || payload.targetDeviceId !== deviceId
    || payload.step !== 1
    || typeof payload.data !== 'string'
    || connection.noise.complete) {
    throw new Error('Invalid Noise IK handshake frame')
  }
  connection.noise.readHandshake(fromBase64Url(payload.data))
  const reply = connection.noise.writeHandshake()
  if (!connection.noise.complete) throw new Error('Noise IK handshake did not complete')
  sendControl('secure.handshake', {
    connectionId,
    targetDeviceId: connection.clientDeviceId,
    step: 2,
    data: toBase64Url(reply),
  } satisfies SecureHandshakePayload)
}

async function handleRelay(value: unknown): Promise<void> {
  const relay = value as Partial<RelayPayload>
  if (typeof relay.connectionId !== 'string' || relay.targetDeviceId !== deviceId || typeof relay.ciphertext !== 'string') {
    throw new Error('Invalid relay payload')
  }
  const connection = connections.get(relay.connectionId)
  if (connection === undefined || !connection.noise.complete) throw new Error('Relay frame belongs to an unauthorized connection')
  if (!Number.isSafeInteger(relay.counter) || relay.counter !== Number(connection.noise.receivingCounter())) {
    throw new Error('Rejected replayed or out-of-order Relay frame')
  }
  const payload = connection.noise.decrypt(fromBase64Url(relay.ciphertext))
  const message = decodeMessage(payload)
  if (message.type !== 'rpc.request') return
  const request = message as RemoteMessage<RpcRequestPayload>
  try {
    await handleRpc(request, relay.connectionId)
  } catch (error) {
    sendMessage(createRpcError(request.id, 'MOCK_HOST_ERROR', error instanceof Error ? error.message : 'Mock Host failure'), relay.connectionId)
  }
}

async function handleRpc(request: RemoteMessage<RpcRequestPayload>, connectionId: string): Promise<void> {
  const { method, params } = request.payload
  if (method === 'harness.api.call') return handleApiCall(request, params, connectionId)
  if (method === 'harness.api.respond') return handleApiRespond(request, params, connectionId)
  if (method === 'harness.api.stream.open') return handleStreamOpen(request, params, connectionId)
  if (method === 'harness.api.stream.close') return handleStreamClose(request, params, connectionId)
  sendMessage(createRpcError(request.id, 'METHOD_NOT_FOUND', `Unknown method ${method}`), connectionId)
}

async function handleApiCall(request: RemoteMessage<RpcRequestPayload>, params: unknown, connectionId: string): Promise<void> {
  const call = asRecord(params)
  if (typeof call.method !== 'string' || typeof call.rpcId !== 'string') {
    throw new Error('Invalid harness.api.call payload')
  }
  const method = call.method
  const payload = isRecord(call.payload) ? call.payload : {}
  let value: unknown
  switch (method) {
    case 'session.list': {
      value = { items: sessions }
      break
    }
    case 'session.history': {
      value = { events: [], hasMore: false }
      break
    }
    case 'session.prompt': {
      const text = promptText(payload)
      value = { accepted: true }
      await streamPrompt(connectionId, String(payload.sessionId), text, call.rpcId)
      break
    }
    case 'session.cancel': {
      value = { accepted: true }
      break
    }
    case 'workspace.list': {
      value = { items: [], archivedSessionIds: [] }
      break
    }
    case 'host.describe': {
      value = {
        version: 'dev-preview',
        cwd: '~/Projects/foo',
        attachedSessions: sessions.filter(session => session.running).length,
        canOpenPath: false,
      }
      break
    }
    default:
      sendMessage(createRpcError(request.id, 'METHOD_NOT_ALLOWED', `Harness API method ${method} is not available in remote mode.`), connectionId)
      return
  }
  sendMessage(createRpcResponse(request.id, {
    rpcId: call.rpcId,
    result: { ok: true, value },
  }), connectionId)
}

async function handleApiRespond(request: RemoteMessage<RpcRequestPayload>, params: unknown, connectionId: string): Promise<void> {
  const respond = asRecord(params)
  const message = isRecord(respond.message) ? respond.message : {}
  if (message.type !== 'client-response' || typeof message.rpcId !== 'string') {
    throw new Error('Invalid harness.api.respond payload')
  }
  if (!respondable.has(message.rpcId)) {
    sendMessage(createRpcError(request.id, 'PERMISSION_NOT_PENDING', 'The response id was not emitted on this connection.'), connectionId)
    return
  }
  respondable.delete(message.rpcId)
  const outcome = extractApprovalOutcome(message.result)
  if (outcome !== undefined) {
    for (const stream of [...streams.entries()]) {
      publish(stream[0], {
        type: 'approval/resolved',
        sessionId: 's1',
        approvalId: 'approval-1',
        outcome,
      })
    }
  }
  sendMessage(createRpcResponse(request.id, { accepted: true }), connectionId)
}

function handleStreamOpen(request: RemoteMessage<RpcRequestPayload>, params: unknown, connectionId: string): void {
  const open = asRecord(params)
  if (typeof open.streamId !== 'string' || (open.stream !== 'mux' && open.stream !== 'host')) {
    throw new Error('Invalid harness.api.stream.open payload')
  }
  if (streams.has(open.streamId)) throw new Error('The Harness event stream is already open.')
  streams.set(open.streamId, { connectionId, stream: open.stream })
  // Subscription baseline for the mux stream, mirroring the plugin bridge.
  for (const session of sessions) {
    publish(open.streamId, {
      type: 'session/subscribed',
      sessionId: session.sessionId,
      lastSeq: 0,
    })
  }
  sendMessage(createRpcResponse(request.id, { opened: true, streamId: open.streamId }), connectionId)
}

function handleStreamClose(request: RemoteMessage<RpcRequestPayload>, params: unknown, connectionId: string): void {
  const close = asRecord(params)
  if (typeof close.streamId !== 'string') throw new Error('Invalid harness.api.stream.close payload')
  const active = streams.delete(close.streamId)
  sendMessage(createRpcResponse(request.id, { closed: active, streamId: close.streamId }), connectionId)
}

async function streamPrompt(connectionId: string, sessionId: string, text: string, promptRpcId: string): Promise<void> {
  const stream = [...streams.values()].find(item => item.connectionId === connectionId && item.stream === 'mux')
  if (stream === undefined) return
  const streamId = [...streams.entries()].find(([, value]) => value === stream)?.[0]
  if (streamId === undefined) return
  const userMessageId = `m-user-${Date.now()}`
  const assistantMessageId = `m-assistant-${Date.now()}`
  publish(streamId, {
    type: 'session/event',
    sessionId,
    event: {
      type: 'user/message',
      seq: 1,
      time: Date.now(),
      data: {
        message: {
          id: userMessageId,
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'user', rpcId: promptRpcId },
        },
      },
    },
  })
  const approvalRpcId = `approval-${Date.now()}`
  respondable.set(approvalRpcId, 'approval')
  publish(streamId, {
    type: 'approval/requested',
    sessionId,
    approvalId: 'approval-1',
    toolName: 'bash',
    reason: 'Run a command outside the sandbox',
  }, approvalRpcId)
  await delay(300)
  publish(streamId, {
    type: 'session/event',
    sessionId,
    event: {
      type: 'assistant/chunk',
      seq: 2,
      time: Date.now(),
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '这是 mock host 的' } },
    },
  })
  await delay(300)
  publish(streamId, {
    type: 'session/event',
    sessionId,
    event: {
      type: 'assistant/chunk',
      seq: 3,
      time: Date.now(),
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'streaming 输出。' } },
    },
  })
  publish(streamId, {
    type: 'session/event',
    sessionId,
    event: {
      type: 'assistant/message',
      seq: 4,
      time: Date.now(),
      data: {
        turn: 1,
        step: 1,
        message: { id: assistantMessageId, role: 'assistant', content: [{ type: 'text', text: '这是 mock host 的 streaming 输出。' }] },
      },
    },
  })
}

function publish(streamId: string, payload: Record<string, unknown>, rpcId = `push-${Date.now()}-${Math.random().toString(36).slice(2)}`): void {
  const stream = streams.get(streamId)
  if (stream === undefined) return
  sendMessage(createMessage('event', {
    event: 'harness.api.frame',
    data: { streamId, frame: { rpcId, payload } },
  }), stream.connectionId)
}

function send(requestId: string, result: unknown, connectionId: string): void {
  sendMessage(createRpcResponse(requestId, result), connectionId)
}

function sendMessage(message: RemoteMessage, connectionId: string): void {
  const connection = connections.get(connectionId)
  if (connection === undefined || !connection.noise.complete) throw new Error('Cannot send on an unauthorized connection')
  const ciphertext = connection.noise.encrypt(encodeMessage(message))
  const counter = Number(connection.noise.sendingCounter() - 1n)
  if (!Number.isSafeInteger(counter) || counter < 0) throw new Error('Noise transport counter overflowed')
  sendControl('relay', {
    connectionId,
    targetDeviceId: connection.clientDeviceId,
    counter,
    ciphertext: toBase64Url(ciphertext),
  } satisfies RelayPayload)
}

async function registerDevice(): Promise<{ accessToken: string }> {
  const device: DeviceDescriptor = {
    deviceId,
    name: 'Mock Harness Host',
    role: 'host',
    platform: process.platform,
    identityKey: keyPair.publicKey,
    clientVersion: '0.5.13',
    harnessVersion: 'dev-preview',
  }
  if (email !== undefined && password !== undefined) {
    const login = await apiRequest<{ token: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }, false)
    return apiRequest('/api/v1/devices/register', {
      method: 'POST',
      body: JSON.stringify({ v: PROTOCOL_VERSION, device }),
    }, false, login.token)
  }
  return apiRequest('/api/v1/devices/register', {
    method: 'POST',
    body: JSON.stringify({ v: PROTOCOL_VERSION, device }),
  }, false)
}

async function apiRequest<TResult>(path: string, init: RequestInit = {}, authenticated = true, accountToken?: string): Promise<TResult> {
  const response = await fetch(`${httpBaseUrl()}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(authenticated && accountToken === undefined ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(accountToken === undefined ? {} : { authorization: `Bearer ${accountToken}` }),
      ...init.headers,
    },
  })
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${await response.text()}`)
  return response.json() as Promise<TResult>
}

function sendControl(type: Parameters<typeof createControlFrame>[0], payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) throw new Error('Control socket is not open')
  socket.send(JSON.stringify(createControlFrame(type, payload)))
}

function httpBaseUrl(): string {
  const url = new URL(server)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = ''
  url.search = ''
  return url.toString().replace(/\/$/, '')
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function promptText(payload: Record<string, unknown>): string {
  const content = Array.isArray(payload.content) ? payload.content : []
  return content.flatMap(block => isRecord(block) && block.type === 'text' && typeof block.text === 'string'
    ? [block.text]
    : []).join('\n')
}

function extractApprovalOutcome(result: unknown): string | undefined {
  const value = isRecord(result) && result.ok === true ? isRecord(result.value) ? result.value : undefined : undefined
  const outcome = value?.outcome
  if (outcome === 'allowed-once' || outcome === 'rejected') return outcome
  return undefined
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
