import { ControlLease } from '@dsh-remote/webrtc'
import { runScenarios, scenarioName } from '../../../scripts/test-scenarios.mjs'
import { NoiseIkSession, createNoisePrologue, generateKeyPair, toBase64Url } from '@dsh-remote/crypto'
import { createControlFrame, createRpcRequest, decodeMessage, encodeMessage, type RemoteMessage } from '@dsh-remote/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionController } from '../src/connection-controller.js'
import type { ResolvedConfig } from '../src/config.js'
import type { HostIdentity, IdentityStore, TrustedPeer } from '../src/identity-store.js'
import type { SafeLogger } from '../src/logging.js'
import { ServerApiError, HostServerApi } from '../src/server-api.js'
import { HostServerConnection } from '../src/server-connection.js'
import type { AuthenticatedPeerChannel } from '../src/types.js'
import { PLUGIN_VERSION } from '../src/version.js'
import { ServerCredentialStore } from '../src/server-credentials.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RtcPeerConnectionFactory } from '@dsh-remote/webrtc'

class FakeWebSocket {
  readyState = 0
  sent: string[] = []
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onSend?: (frame: unknown) => void

  open(): void { this.readyState = 1; this.onopen?.({}) }
  receive(frame: unknown): void { this.onmessage?.({ data: JSON.stringify(frame) }) }
  send(data: string): void {
    this.sent.push(data)
    this.onSend?.(JSON.parse(data))
  }
  close(code = 1000, reason = ''): void { this.readyState = 3; this.onclose?.({ code, reason }) }
}

describe('HostServerConnection', () => {
  it('starts the hello timeout after the WebSocket upgrade completes', async () => {
    vi.useFakeTimers()
    const socket = new FakeWebSocket()
    const api = {
      baseUrl: 'https://remote.test',
      authenticate: async () => ({ accessToken: 'test-token' }),
    } as unknown as HostServerApi
    const server = new HostServerConnection(
      config(),
      { schemaVersion: 1, deviceId: 'host-1', name: 'Host', fingerprint: 'HOST',
        ...generateKeyPair(new Uint8Array(32).fill(51)) },
      { trustedPeer: () => undefined } as unknown as IdentityStore,
      api,
      { close: async () => {} } as unknown as ConnectionController,
      logger(),
      () => socket,
    )
    try {
      server.start()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(15_000)
      expect(socket.readyState).toBe(0)

      socket.open()
      socket.receive(createControlFrame('hello.ack', helloAck('control-1')))
      await vi.advanceTimersByTimeAsync(0)
      expect(server.isOnline()).toBe(true)
    } finally {
      try {
        await server.stop()
        expect(vi.getTimerCount()).toBe(0)
      } finally { vi.useRealTimers(); vi.restoreAllMocks() }
    }
  })

  it('keeps the responder alive for the Server RTC budget and preserves legacy defaults', async () => {
    await runScenarios([
      { name: 'twenty-second Server', timeout: 20000, expected: 20000 },
      { name: 'legacy Server without timeout', timeout: undefined, expected: 12000 },
      { name: 'shorter Server budget preserves local minimum', timeout: 8000, expected: 12000 },
    ].map(row => ({ name: row.name, run: async () => {
      vi.useFakeTimers()
      const hostKeys = generateKeyPair(new Uint8Array(32).fill(51))
      const clientKeys = generateKeyPair(new Uint8Array(32).fill(52))
      const peer = { deviceId: 'client-1', name: 'Client', platform: 'linux', publicKey: clientKeys.publicKey,
        fingerprint: 'CLIENT', membershipId: 'member', trustedAt: 1 }
      const socket = new FakeWebSocket()
      const pc = { connectionState: 'new', iceConnectionState: 'new', iceGatheringState: 'new',
        setRemoteDescription: async () => {}, createAnswer: async () => ({ type: 'answer', sdp: 'answer' }),
        setLocalDescription: async () => {}, getStats: async () => [], close: vi.fn() }
      const server = new HostServerConnection({ ...config(), forceRelay: false },
        { schemaVersion: 1, deviceId: 'host-1', name: 'Host', fingerprint: 'HOST', ...hostKeys },
        { trustedPeer: () => peer } as unknown as IdentityStore,
        { baseUrl: 'https://remote.test', authenticate: async () => ({ accessToken: 'test-token' }),
          deviceFor: async () => ({ ...peer, role: 'client', identityKey: clientKeys.publicKey }),
          turnCredentials: async () => [],
        } as unknown as HostServerApi,
        { close: async () => {} } as unknown as ConnectionController, logger(), () => socket,
        async () => ({ create: () => pc }) as unknown as RtcPeerConnectionFactory)
      try {
        server.start()
        await vi.advanceTimersByTimeAsync(0)
        socket.open()
        socket.receive(createControlFrame('hello.ack', { ...helloAck('control-1'),
          capabilities: ['transport.p2p', 'transport.turn', 'transport.relay'],
          ...(row.timeout === undefined ? {} : { webrtcFallbackTimeoutMs: row.timeout }),
        }))
        socket.receive(createControlFrame('connect.incoming', { connectionId: 'connection-1',
          clientDeviceId: 'client-1', clientIdentityKey: clientKeys.publicKey,
          authorization: 'account', preferredTransports: ['p2p', 'turn', 'relay'],
        }))
        socket.receive(createControlFrame('signal.offer', { connectionId: 'connection-1', targetDeviceId: 'host-1', sdp: 'offer' }))
        await vi.advanceTimersByTimeAsync(row.expected - 1)
        expect(socket.sent.map(frame => JSON.parse(frame).type)).toContain('signal.answer')
        expect(pc.close).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        expect(pc.close).toHaveBeenCalledOnce()
        expect(socket.readyState).toBe(1)
      } finally {
        try {
          await server.stop()
          expect(vi.getTimerCount()).toBe(0)
        } finally { vi.useRealTimers(); vi.restoreAllMocks() }
      }
    } })))
  })

  it('matches the deployed Server frames and exposes RPC only after Noise IK', async () => {
    const hostKeys = generateKeyPair(new Uint8Array(32).fill(11))
    const clientKeys = generateKeyPair(new Uint8Array(32).fill(12))
    const identity: HostIdentity = {
      schemaVersion: 1,
      deviceId: 'host-1',
      name: 'Host',
      fingerprint: 'HOST',
      ...hostKeys,
    }
    const peer: TrustedPeer = {
      deviceId: 'client-1',
      name: 'Phone',
      platform: 'android',
      publicKey: clientKeys.publicKey,
      fingerprint: 'CLIENT',
      trustedAt: 1,
      membershipId: 'membership-1',
    }
    const socket = new FakeWebSocket()
    let accepted: AuthenticatedPeerChannel | undefined
    let acceptedAtHandshakeReply: AuthenticatedPeerChannel | undefined
    socket.onSend = frame => {
      const value = frame as { type?: unknown; payload?: { step?: unknown } }
      if (value.type === 'secure.handshake' && value.payload?.step === 2) {
        acceptedAtHandshakeReply = accepted
      }
    }
    const connections = {
      accept: vi.fn(async (channel: AuthenticatedPeerChannel) => { accepted = channel }),
      closeConnection: vi.fn(async (connectionId: string, code?: string) => {
        if (accepted?.security.connectionId !== connectionId) return false
        await accepted.close(code)
        return true
      }),
      close: vi.fn(async () => undefined),
    } as unknown as ConnectionController
    const api = {
      baseUrl: 'https://dsh.r2049.cn',
      authenticate: vi.fn(async () => ({ accessToken: 'access-token-value' })),
      refreshCredentials: vi.fn(),
      deviceFor: vi.fn(async () => ({
        deviceId: peer.deviceId,
        name: peer.name,
        role: 'client',
        platform: peer.platform,
        identityKey: peer.publicKey,
        membershipId: peer.membershipId!,
      })),
    } as unknown as HostServerApi
    const trustPeer = vi.fn(async (input: Omit<TrustedPeer, 'fingerprint' | 'trustedAt'>) => ({
      ...input,
      fingerprint: 'CLIENT',
      trustedAt: 1,
    }))
    const log = logger()
    const server = new HostServerConnection(
      config(),
      identity,
      { trustedPeer: vi.fn(() => undefined), trustPeer } as unknown as IdentityStore,
      api,
      connections,
      log,
      () => socket,
      undefined,
      () => ['harness.api.v1', 'fileviewer.read.v1'],
      '0.1.0-rc.8',
    )
    server.start()
    await flush()
    socket.open()
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      type: 'hello',
      payload: {
        role: 'host',
        deviceId: 'host-1',
        clientVersion: PLUGIN_VERSION,
        harnessVersion: '0.1.0-rc.8',
        capabilities: ['transport.relay.resume.v1', 'transport.relay', 'transport.relay.attach', 'harness.api.v1', 'fileviewer.read.v1'],
      },
    })
    socket.receive(createControlFrame('hello.ack', {
      protocol: 1,
      serverVersion: '0.1.0',
      connectionSessionId: 'control-1',
      heartbeatIntervalMs: 25_000,
      maxControlFrameBytes: 65_536,
      maxRelayFrameBytes: 1_048_576,
      capabilities: ['transport.relay', 'harness.api.v1', 'fileviewer.read.v1'],
    }))
    socket.receive(createControlFrame('connect.incoming', {
      connectionId: 'connection-1',
      clientDeviceId: 'client-1',
      clientIdentityKey: clientKeys.publicKey,
      authorization: 'account',
      preferredTransports: ['relay'],
    }))
    await flush()
    expect(JSON.parse(socket.sent[1]!)).toEqual(expect.objectContaining({
      type: 'connect.accepted',
      payload: { connectionId: 'connection-1' },
    }))
    expect(trustPeer).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'client-1',
      publicKey: clientKeys.publicKey,
      membershipId: 'membership-1',
    }))

    const clientNoise = new NoiseIkSession({
      role: 'initiator',
      localPrivateKey: clientKeys.privateKey,
      localPublicKey: clientKeys.publicKey,
      remotePublicKey: hostKeys.publicKey,
      prologue: createNoisePrologue('connection-1', 'host-1', 'client-1'),
    })
    socket.receive(createControlFrame('secure.handshake', {
      connectionId: 'connection-1',
      targetDeviceId: 'host-1',
      step: 1,
      data: toBase64Url(clientNoise.writeHandshake()),
    }))
    await flush()
    const handshakeReply = JSON.parse(socket.sent[2]!)
    expect(handshakeReply).toMatchObject({ type: 'secure.handshake', payload: { step: 2, targetDeviceId: 'client-1' } })
    expect(acceptedAtHandshakeReply).toBe(accepted)
    clientNoise.readHandshake(fromBase64UrlForTest(handshakeReply.payload.data))
    expect(accepted?.security).toEqual({
      protocol: 'Noise_IK_25519_ChaChaPoly_SHA256',
      connectionId: 'connection-1',
      membershipId: 'membership-1',
    })

    let received: RemoteMessage | undefined
    accepted!.onMessage(message => { received = message })
    const request = createRpcRequest('harness.api.call', { method: 'host.describe', rpcId: 'native-1', payload: {} })
    socket.receive(createControlFrame('relay', {
      connectionId: 'connection-1',
      targetDeviceId: 'host-1',
      counter: 0,
      ciphertext: toBase64Url(clientNoise.encrypt(encodeMessage(request))),
    }))
    await flush()
    expect(received).toEqual(request)

    await accepted!.send(request)
    const relay = JSON.parse(socket.sent[3]!)
    expect(relay).toMatchObject({ type: 'relay', payload: { counter: 0, targetDeviceId: 'client-1' } })
    expect(decodeMessage(clientNoise.decrypt(fromBase64UrlForTest(relay.payload.ciphertext)))).toEqual(request)

    socket.receive(createControlFrame('error', {
      code: 'CONNECTION_FAILED',
      message: 'the remote peer disconnected',
      retryable: true,
      connectionId: 'connection-1',
    }))
    await flush()
    expect(connections.closeConnection).toHaveBeenCalledWith(
      'connection-1',
      'CONNECTION_FAILED',
      { closedBy: 'server', retryable: true },
    )
    // The default log level must show that the Server closed this tunnel.
    // CONNECTION_FAILED is also the Host's local fallback code, so a debug-only
    // message made both paths look identical in production logs.
    expect(log.info).toHaveBeenCalledWith('server closed a remote connection', {
      code: 'CONNECTION_FAILED',
      connectionId: 'connection-1',
      retryable: true,
    })
    expect(log.debug).not.toHaveBeenCalledWith(
      'server closed a remote connection',
      expect.anything(),
    )
    expect(server.lastError()).toBeUndefined()
    expect(socket.readyState).toBe(1)

    // A disconnected Client can leave an already-queued Relay frame behind.
    // The stale connection must be isolated instead of taking down the Host's
    // long-lived Server control socket or another Client tunnel.
    socket.receive(createControlFrame('relay', {
      connectionId: 'connection-1',
      targetDeviceId: 'host-1',
      counter: 1,
      ciphertext: toBase64Url(clientNoise.encrypt(encodeMessage(request))),
    }))
    await flush()
    expect(socket.readyState).toBe(1)

    await server.stop()
  })

  it('attaches assigned Relay data sockets and keeps ciphertext off control', async () => {
    const hostKeys = generateKeyPair(new Uint8Array(32).fill(71))
    const clientKeys = generateKeyPair(new Uint8Array(32).fill(72))
    const identity: HostIdentity = {
      schemaVersion: 1,
      deviceId: 'host-relay',
      name: 'Host',
      fingerprint: 'HOST',
      ...hostKeys,
    }
    const peer: TrustedPeer = {
      deviceId: 'client-relay',
      name: 'Phone',
      platform: 'android',
      publicKey: clientKeys.publicKey,
      fingerprint: 'CLIENT',
      trustedAt: 1,
      membershipId: 'membership-relay',
    }
    const control = new FakeWebSocket()
    const sockets = [control]
    const createWebSocket = vi.fn((url: string) => {
      if (url.endsWith('/ws/v1/connect')) return control
      const socket = new FakeWebSocket()
      sockets.push(socket)
      return socket
    })
    let accepted: AuthenticatedPeerChannel | undefined
    const connections = {
      accept: vi.fn(async (channel: AuthenticatedPeerChannel) => { accepted = channel }),
      closeConnection: vi.fn(async () => true),
      close: vi.fn(async () => undefined),
    } as unknown as ConnectionController
    const api = {
      baseUrl: 'https://dsh.r2049.cn',
      authenticate: vi.fn(async () => ({ accessToken: 'access-token-value' })),
      deviceFor: vi.fn(async () => ({
        deviceId: peer.deviceId,
        name: peer.name,
        role: 'client',
        platform: peer.platform,
        identityKey: peer.publicKey,
        membershipId: peer.membershipId!,
      })),
    } as unknown as HostServerApi
    const server = new HostServerConnection(
      { ...config(), forceRelay: true },
      identity,
      { trustedPeer: vi.fn(() => undefined), trustPeer: vi.fn(async (input: Omit<TrustedPeer, 'fingerprint' | 'trustedAt'>) => ({ ...input, fingerprint: 'CLIENT', trustedAt: 1 })) } as unknown as IdentityStore,
      api,
      connections,
      logger(),
      createWebSocket,
    )
    server.start()
    await flush()
    control.open()
    control.receive(createControlFrame('hello.ack', { ...helloAck('control-relay'), capabilities: ['transport.relay', 'transport.relay.attach'] }))
    control.receive(createControlFrame('connect.incoming', {
      connectionId: 'connection-relay',
      clientDeviceId: peer.deviceId,
      clientIdentityKey: peer.publicKey,
      authorization: 'account',
      preferredTransports: ['relay'],
      relayEndpoint: 'wss://relay.example/ws',
      relayTicket: 'dshrt.host-ticket',
      relayNodeId: 'relay-1',
      relayEpoch: 4,
    }))
    await flush()
    expect(JSON.parse(control.sent[1]!)).toMatchObject({ type: 'connect.accepted', payload: { connectionId: 'connection-relay' } })
    control.receive(createControlFrame('transport.selected', {
      connectionId: 'connection-relay',
      targetDeviceId: identity.deviceId,
      transport: 'relay',
    }))
    await flush()
    expect(sockets).toHaveLength(2)
    const data = sockets[1]!
    data.open()
    expect(JSON.parse(data.sent[0]!)).toMatchObject({
      type: 'relay.attach',
      payload: {
        connectionId: 'connection-relay',
        deviceId: identity.deviceId,
        peerDeviceId: peer.deviceId,
        ticket: 'dshrt.host-ticket',
      },
    })
    data.receive({ v: 1, id: 'ready', type: 'relay.ready', timestamp: Date.now(), payload: { connectionId: 'connection-relay', epoch: 4 } })
    await flush()

    const clientNoise = new NoiseIkSession({
      role: 'initiator',
      localPrivateKey: clientKeys.privateKey,
      localPublicKey: clientKeys.publicKey,
      remotePublicKey: hostKeys.publicKey,
      prologue: createNoisePrologue('connection-relay', identity.deviceId, peer.deviceId),
    })
    control.receive(createControlFrame('secure.handshake', {
      connectionId: 'connection-relay',
      targetDeviceId: identity.deviceId,
      step: 1,
      data: toBase64Url(clientNoise.writeHandshake()),
    }))
    await flush()
    const handshakeReply = JSON.parse(control.sent.find(frame => JSON.parse(frame).type === 'secure.handshake')!)
    clientNoise.readHandshake(fromBase64UrlForTest(handshakeReply.payload.data))
    expect(accepted).toBeDefined()
    const request = createRpcRequest('harness.api.call', { method: 'host.describe', rpcId: 'relay-1', payload: {} })
    data.receive({
      v: 1,
      id: 'relay-in',
      type: 'relay',
      timestamp: Date.now(),
      payload: {
        connectionId: 'connection-relay',
        targetDeviceId: identity.deviceId,
        counter: 0,
        ciphertext: toBase64Url(clientNoise.encrypt(encodeMessage(request))),
      },
    })
    await flush()
    await accepted!.send(request)
    const outgoing = JSON.parse(data.sent[1]!)
    expect(outgoing).toMatchObject({ type: 'relay', payload: { connectionId: 'connection-relay', targetDeviceId: peer.deviceId, counter: 0 } })
    expect(control.sent.filter(frame => JSON.parse(frame).type === 'relay')).toHaveLength(0)
    await server.stop()
  })

  it('stops reconnecting until account authorization is supplied', async () => {
    const keys = generateKeyPair(new Uint8Array(32).fill(13))
    const api = {
      baseUrl: 'https://dsh.r2049.cn',
      authenticate: vi.fn(async () => {
        throw new ServerApiError('ACCOUNT_AUTH_REQUIRED', 'account login required', false, 401)
      }),
    } as unknown as HostServerApi
    const server = new HostServerConnection(
      { ...config(), reconnect: { ...config().reconnect, enabled: true } },
      { schemaVersion: 1, deviceId: 'host-2', name: 'Host', fingerprint: 'HOST', ...keys },
      { trustedPeer: vi.fn() } as unknown as IdentityStore,
      api,
      { close: vi.fn(async () => undefined) } as unknown as ConnectionController,
      logger(),
      () => new FakeWebSocket(),
    )

    server.start()
    await flush()
    expect(api.authenticate).toHaveBeenCalledTimes(1)
    expect(server.lastError()).toBe('ACCOUNT_AUTH_REQUIRED')
    await server.stop()
  })

  it('reconnects immediately on request and retains the last Server activity time', async () => {
    const keys = generateKeyPair(new Uint8Array(32).fill(14))
    const sockets = [new FakeWebSocket(), new FakeWebSocket()]
    let socketIndex = 0
    const createWebSocket = vi.fn(() => sockets[socketIndex++]!)
    const api = {
      baseUrl: 'https://dsh.r2049.cn',
      authenticate: vi.fn(async () => ({ accessToken: 'access-token-value' })),
    } as unknown as HostServerApi
    const server = new HostServerConnection(
      config(),
      { schemaVersion: 1, deviceId: 'host-3', name: 'Host', fingerprint: 'HOST', ...keys },
      { trustedPeer: vi.fn() } as unknown as IdentityStore,
      api,
      { close: vi.fn(async () => undefined) } as unknown as ConnectionController,
      logger(),
      createWebSocket,
    )

    server.start()
    await flush()
    sockets[0]!.open()
    sockets[0]!.receive(createControlFrame('hello.ack', helloAck('control-1')))
    await flush()
    expect(server.isOnline()).toBe(true)
    expect(server.lastActivity()).toEqual(expect.any(Number))

    server.reconnect()
    expect(sockets[0]!.readyState).toBe(3)
    await flush()
    expect(createWebSocket).toHaveBeenCalledTimes(2)
    expect(server.isReconnecting()).toBe(true)

    sockets[1]!.open()
    sockets[1]!.receive(createControlFrame('hello.ack', helloAck('control-2')))
    await flush()
    expect(server.isOnline()).toBe(true)
    expect(server.lastError()).toBeUndefined()
    await server.stop()
  })

  it('recovers control authentication only within the authorized retry budget', async () => {
    const rows = [
      'recover',
      'recover-error-frame',
      'recover-4001-token-expired',
      'recover-after-heartbeat-timeout',
      'reject-again',
      'reject-again-error-frame',
      'refresh-rejected',
      'revoked',
      'revoked-frame',
      'replaced',
      'replaced-before-ack',
      'stopped',
    ] as const
    await runScenarios(
      rows.map((row, index) => {
        const scenario = row
        return {
          name: scenarioName('handles control authentication recovery: %s', row, index),
          run: async () => {
            const keys = generateKeyPair(new Uint8Array(32).fill(24))
            const sockets: FakeWebSocket[] = []
            let refreshed = false
            const api = {
              baseUrl: 'https://dsh.r2049.cn',
              authenticate: vi.fn(async () => ({
                accessToken: refreshed ? 'new-access-value' : 'old-access-value',
              })),
              refreshCredentials: vi.fn(async () => {
                if (scenario === 'refresh-rejected')
                  throw new ServerApiError('AUTH_INVALID', 'refresh rejected', false, 401, 'credential_refresh')
                refreshed = true
              }),
              clearAuthorization: vi.fn(async () => undefined),
            } as unknown as HostServerApi
            const logs = logger()
            const server = new HostServerConnection(
              { ...config(), reconnect: { enabled: true, initialDelayMs: 1, maxDelayMs: 1, jitter: 0 } },
              { schemaVersion: 1, deviceId: 'host-recovery', name: 'Host', fingerprint: 'HOST', ...keys },
              { trustedPeer: vi.fn() } as unknown as IdentityStore,
              api,
              { close: vi.fn(async () => undefined) } as unknown as ConnectionController,
              logs,
              () => {
                const socket = new FakeWebSocket()
                sockets.push(socket)
                return socket
              },
            )
            try {
              server.start()
              await flush()
              sockets[0]!.open()
              if (scenario === 'replaced') {
                sockets[0]!.receive(createControlFrame('hello.ack', helloAck('control-first')))
                await flush()
              }
              if (scenario === 'stopped') await server.stop()
              else if (scenario === 'revoked-frame') {
                sockets[0]!.receive(createControlFrame('hello.ack', helloAck('control-revoked')))
                await flush()
                sockets[0]!.receive(
                  createControlFrame('error', {
                    code: 'DEVICE_REVOKED',
                    message: 'device revoked',
                    retryable: false,
                  }),
                )
              } else if (scenario === 'recover-error-frame' || scenario === 'reject-again-error-frame') {
                sockets[0]!.receive(
                  createControlFrame('error', {
                    code: 'AUTH_INVALID',
                    message: 'invalid access token',
                    retryable: false,
                  }),
                )
              } else if (scenario === 'recover-4001-token-expired') {
                sockets[0]!.receive(
                  createControlFrame('error', {
                    code: 'TOKEN_EXPIRED',
                    message: 'TOKEN_EXPIRED',
                    retryable: false,
                  }),
                )
                sockets[0]!.close(4001, 'TOKEN_EXPIRED')
              } else if (scenario === 'recover-after-heartbeat-timeout') {
                sockets[0]!.receive(createControlFrame('hello.ack', helloAck('control-initial')))
                await flush()
                sockets[0]!.close(4009, 'heartbeat timeout')
                await new Promise((resolve) => setTimeout(resolve, 15))
                expect(sockets).toHaveLength(2)
                sockets[1]!.open()
                sockets[1]!.receive(
                  createControlFrame('error', {
                    code: 'AUTH_INVALID',
                    message: 'invalid access token',
                    retryable: false,
                  }),
                )
              } else {
                sockets[0]!.close(scenario.startsWith('replaced') ? 4003 : scenario === 'revoked' ? 4004 : 4002)
              }
              await flush()
              if (scenario === 'recover-after-heartbeat-timeout') {
                expect(sockets).toHaveLength(3)
                expect(api.refreshCredentials).toHaveBeenCalledWith('old-access-value')
                sockets[2]!.open()
                expect(JSON.parse(sockets[2]!.sent[0]!).payload.accessToken).toBe('new-access-value')
                sockets[2]!.receive(createControlFrame('hello.ack', helloAck('control-recovered-after-4009')))
                await flush()
                expect(server.isOnline()).toBe(true)
                expect(server.lastError()).toBeUndefined()
                expect(api.refreshCredentials).toHaveBeenCalledTimes(1)
              } else if (
                scenario === 'recover'
                || scenario === 'recover-error-frame'
                || scenario === 'recover-4001-token-expired'
                || scenario === 'reject-again'
                || scenario === 'reject-again-error-frame'
              ) {
                expect(sockets).toHaveLength(2)
                expect(api.refreshCredentials).toHaveBeenCalledWith('old-access-value')
                sockets[1]!.open()
                expect(JSON.parse(sockets[1]!.sent[0]!).payload.accessToken).toBe('new-access-value')
                if (
                  scenario === 'recover'
                  || scenario === 'recover-error-frame'
                  || scenario === 'recover-4001-token-expired'
                ) {
                  sockets[1]!.receive(createControlFrame('hello.ack', helloAck('control-recovered')))
                  await flush()
                  expect(server.isOnline()).toBe(true)
                  expect(server.lastError()).toBeUndefined()
                } else {
                  if (scenario === 'reject-again-error-frame') {
                    sockets[1]!.receive(
                      createControlFrame('error', {
                        code: 'AUTH_INVALID',
                        message: 'invalid access token',
                        retryable: false,
                      }),
                    )
                  } else {
                    sockets[1]!.close(4002)
                  }
                  await new Promise((resolve) => setTimeout(resolve, 20))
                  expect(sockets).toHaveLength(2)
                  expect(server.lastError()).toBe('AUTH_INVALID')
                  expect(server.isReconnecting()).toBe(false)
                }
                expect(api.refreshCredentials).toHaveBeenCalledTimes(1)
              } else {
                await new Promise((resolve) => setTimeout(resolve, 20))
                expect(sockets).toHaveLength(1)
                expect(server.isReconnecting()).toBe(false)
                expect(api.refreshCredentials).toHaveBeenCalledTimes(scenario === 'refresh-rejected' ? 1 : 0)
                expect(api.clearAuthorization).toHaveBeenCalledTimes(scenario.startsWith('revoked') ? 1 : 0)
                if (scenario !== 'stopped')
                  expect(server.lastError()).toBe(
                    scenario.startsWith('replaced')
                      ? 'CONNECTION_REPLACED'
                      : scenario.startsWith('revoked')
                        ? 'DEVICE_REVOKED'
                        : 'AUTH_INVALID',
                  )
                if (scenario === 'refresh-rejected')
                  expect(logs.warn).toHaveBeenCalledWith('server control connection failed', {
                    code: 'AUTH_INVALID',
                    retryable: false,
                    phase: 'credential_refresh',
                    status: 401,
                  })
              }
            } finally {
              await server.stop()
            }
          },
        }
      }),
    )
  })

  it('recovers retryable refresh failures without spending the handshake retry', async () => {
    const rows = ['RATE_LIMITED', 'CONNECTION_FAILED', 'SERVER_CREDENTIALS_BUSY'] as const
    await runScenarios(
      rows.map((row, index) => {
        const code = row
        return {
          name: scenarioName(
            'recovers after a retryable refresh failure (%s) without spending the handshake retry',
            row,
            index,
          ),
          run: async () => {
            const sockets: FakeWebSocket[] = []
            let accessToken = 'old-access-value'
            const refreshCredentials = vi
              .fn()
              .mockRejectedValueOnce(
                new ServerApiError(
                  code,
                  'temporary refresh failure',
                  true,
                  code === 'RATE_LIMITED' ? 429 : undefined,
                  'credential_refresh',
                ),
              )
              .mockImplementation(async () => {
                accessToken = 'new-access-value'
              })
            const api = {
              baseUrl: 'https://dsh.r2049.cn',
              authenticate: vi.fn(async () => ({ accessToken })),
              refreshCredentials,
            } as unknown as HostServerApi
            const server = new HostServerConnection(
              { ...config(), reconnect: { enabled: true, initialDelayMs: 1, maxDelayMs: 1, jitter: 0 } },
              {
                schemaVersion: 1,
                deviceId: 'host-retry-refresh',
                name: 'Host',
                fingerprint: 'HOST',
                ...generateKeyPair(),
              },
              { trustedPeer: vi.fn() } as unknown as IdentityStore,
              api,
              { close: vi.fn(async () => undefined) } as unknown as ConnectionController,
              logger(),
              () => {
                const socket = new FakeWebSocket()
                sockets.push(socket)
                return socket
              },
            )
            try {
              server.start()
              await vi.waitFor(() => expect(sockets).toHaveLength(1))
              sockets[0]!.open()
              sockets[0]!.close(4002)
              await vi.waitFor(() => expect(sockets).toHaveLength(2))
              expect(server.lastError()).toBe(code)
              expect(server.isReconnecting()).toBe(true)
              sockets[1]!.open()
              expect(JSON.parse(sockets[1]!.sent[0]!).payload.accessToken).toBe('old-access-value')
              sockets[1]!.close(4002)
              await vi.waitFor(() => expect(sockets).toHaveLength(3))
              expect(refreshCredentials).toHaveBeenCalledTimes(2)
              expect(refreshCredentials).toHaveBeenNthCalledWith(2, 'old-access-value')
              sockets[2]!.open()
              expect(JSON.parse(sockets[2]!.sent[0]!).payload.accessToken).toBe('new-access-value')
              sockets[2]!.receive(createControlFrame('hello.ack', helloAck('control-retry-refresh')))
              await vi.waitFor(() => expect(server.isOnline()).toBe(true))
              expect(server.lastError()).toBeUndefined()
            } finally {
              await server.stop()
            }
          },
        }
      }),
    )
  })

  it('notifies the Server and closes the RTC when an authenticated channel is closed directly', async () => {
    const hostKeys = generateKeyPair()
    const clientKeys = generateKeyPair()
    const noise = new NoiseIkSession({ role: 'responder', localPrivateKey: hostKeys.privateKey,
      localPublicKey: hostKeys.publicKey, remotePublicKey: clientKeys.publicKey,
      prologue: createNoisePrologue('connection-1', 'host-1', 'client-1') })
    const initiator = new NoiseIkSession({ role: 'initiator', localPrivateKey: clientKeys.privateKey,
      localPublicKey: clientKeys.publicKey, remotePublicKey: hostKeys.publicKey,
      prologue: createNoisePrologue('connection-1', 'host-1', 'client-1') })
    const rtc = { send: vi.fn(async () => undefined), close: vi.fn(async () => undefined) }
    const dataSocket = { close: vi.fn() }
    const socket = new FakeWebSocket()
    socket.readyState = 1
    let channel: AuthenticatedPeerChannel | undefined
    const server = new HostServerConnection(
      config(), { schemaVersion: 1, deviceId: 'host-1', name: 'Host', fingerprint: 'HOST', ...hostKeys },
      {} as IdentityStore, { baseUrl: 'https://dsh.r2049.cn' } as HostServerApi,
      { accept: vi.fn(async (value: AuthenticatedPeerChannel) => { channel = value }), close: vi.fn(async () => undefined) } as unknown as ConnectionController,
      logger(), () => socket,
    )
    const requests: Array<{ connectionId: string; requestId: string; ticket: string }> = []
    const lease = new ControlLease('connection-1', 'ticket', payload => { requests.push(payload) }, () => {})
    lease.start()
    lease.acknowledge({ ...requests[0]!, ticket: 'confirmed', leaseMs: 300_000 })
    const tunnel = { connectionId: 'connection-1', membershipId: 'membership-1',
      peer: { deviceId: 'client-1', publicKey: clientKeys.publicKey }, noise, transport: 'p2p', rtc, dataSocket, lease }
    const internals = server as unknown as { socket: FakeWebSocket; tunnels: Map<string, unknown>; completeHandshake(tunnel: unknown, payload: unknown): Promise<void>; dropTunnel(id: string): Promise<void> }
    internals.socket = socket
    internals.tunnels.set('connection-1', tunnel)
    try {
      await internals.completeHandshake(tunnel, { connectionId: 'connection-1', targetDeviceId: 'host-1', step: 1, data: toBase64Url(initiator.writeHandshake()) })
      await channel!.close()
      await channel!.close()
      await internals.dropTunnel('connection-1')
      expect(socket.sent.map(raw => JSON.parse(raw)).filter(frame => frame.type === 'connection.lease.close'))
        .toEqual([expect.objectContaining({ payload: { connectionId: 'connection-1' } })])
      expect(rtc.close).toHaveBeenCalledOnce()
      expect(dataSocket.close).toHaveBeenCalledOnce()
      expect(lease.canDetach()).toBe(false)
      expect(internals.tunnels.size).toBe(0)
    } finally { lease.stop(); initiator.destroy(); await server.stop() }
  })

  it('disconnects an authenticated peer when its selected WebRTC channel fails', async () => {
    const keys = generateKeyPair(new Uint8Array(32).fill(15))
    const closeConnection = vi.fn(async () => true)
    const rtc = { close: vi.fn(async () => undefined) }
    const tunnel = {
      connectionId: 'connection-rtc',
      membershipId: 'membership-rtc',
      peer: { deviceId: 'client-rtc' },
      noise: { destroy: vi.fn() },
      transport: 'p2p',
      rtc,
      channel: {},
    }
    const server = new HostServerConnection(
      config(),
      { schemaVersion: 1, deviceId: 'host-rtc', name: 'Host', fingerprint: 'HOST', ...keys },
      { trustedPeer: vi.fn() } as unknown as IdentityStore,
      { baseUrl: 'https://dsh.r2049.cn' } as HostServerApi,
      { closeConnection } as unknown as ConnectionController,
      logger(),
      () => new FakeWebSocket(),
    )
    const internals = server as unknown as {
      tunnels: Map<string, unknown>
      handleRtcFailed(tunnel: unknown, rtc: unknown, error: Error): Promise<void>
    }
    internals.tunnels.set(tunnel.connectionId, tunnel)

    await internals.handleRtcFailed(tunnel, rtc, new Error('data channel closed'))

    expect(closeConnection).toHaveBeenCalledWith(tunnel.connectionId, 'CONNECTION_FAILED')
    expect(rtc.close).toHaveBeenCalledOnce()
    expect(internals.tunnels.has(tunnel.connectionId)).toBe(false)
  })

  it('closes an established WebRTC peer when the Server Control socket closes', async () => {
    const socket = new FakeWebSocket()
    const rtc = { close: vi.fn(async () => undefined) }
    const channel = { close: vi.fn(async () => undefined) }
    const connections = { close: vi.fn(async () => undefined) } as unknown as ConnectionController
    const server = new HostServerConnection(
      config(),
      { schemaVersion: 1, deviceId: 'host-rtc', name: 'Host', fingerprint: 'HOST', ...generateKeyPair() },
      { trustedPeer: vi.fn() } as unknown as IdentityStore,
      { baseUrl: 'https://dsh.r2049.cn', authenticate: vi.fn(async () => ({ accessToken: 'access-token' })) } as unknown as HostServerApi,
      connections,
      logger(),
      () => socket,
    )
    const internals = server as unknown as { tunnels: Map<string, unknown> }
    try {
      server.start()
      await flush()
      socket.open()
      socket.receive(createControlFrame('hello.ack', helloAck('control-rtc')))
      await vi.waitFor(() => expect(server.isOnline()).toBe(true))
      internals.tunnels.set('connection-rtc', { transport: 'p2p', rtc, channel })

      socket.close(1012, 'Server restart')

      await vi.waitFor(() => expect(channel.close).toHaveBeenCalledOnce())
      expect(rtc.close).toHaveBeenCalledOnce()
      expect(connections.close).toHaveBeenCalledOnce()
      expect(internals.tunnels.size).toBe(0)
    } finally {
      await server.stop()
    }
  })

  it('closes a confirmed RTC tunnel when control fails and automatic reconnect is disabled', async () => {
    const socket = new FakeWebSocket()
    const rtc = { close: vi.fn(async () => undefined) }
    const channel = { close: vi.fn(async () => undefined) }
    const connections = { close: vi.fn(async () => undefined) } as unknown as ConnectionController
    const cfg = config()
    const server = new HostServerConnection(
      { ...cfg, forceRelay: false },
      { schemaVersion: 1, deviceId: 'host-rtc', name: 'Host', fingerprint: 'HOST', ...generateKeyPair() },
      { trustedPeer: vi.fn() } as unknown as IdentityStore,
      { baseUrl: 'https://dsh.r2049.cn', authenticate: vi.fn(async () => ({ accessToken: 'access-token' })) } as unknown as HostServerApi,
      connections, logger(), () => socket, async () => undefined,
    )
    const requests: Array<{ connectionId: string; requestId: string; ticket: string }> = []
    const lease = new ControlLease('connection-rtc', 'ticket', payload => { requests.push(payload) }, () => {})
    lease.start()
    lease.acknowledge({ ...requests[0]!, ticket: 'confirmed', leaseMs: 300_000 })
    try {
      server.start()
      await flush()
      socket.open()
      socket.receive(createControlFrame('hello.ack', { ...helloAck('control-rtc'), capabilities: ['transport.p2p', 'transport.webrtc.resume.v1'] }))
      await vi.waitFor(() => expect(server.isOnline()).toBe(true))
      const internals = server as unknown as { tunnels: Map<string, unknown> }
      internals.tunnels.set('connection-rtc', { connectionId: 'connection-rtc', transport: 'p2p', rtc, channel, lease })
      socket.close(1012, 'Server restart')
      await vi.waitFor(() => expect(channel.close).toHaveBeenCalledOnce())
      expect(rtc.close).toHaveBeenCalledOnce()
      expect(internals.tunnels.size).toBe(0)
      expect(lease.canDetach()).toBe(false)
    } finally {
      await server.stop()
      lease.stop()
    }
  })

  it('retains confirmed RTC on recovery and falls back safely after a Server rollback', async () => {
    // Hosted Server shutdown closes with 4001/'server shutdown'; apps/server
    // uses 4009. Both must retain because the reason string is the semantic
    // key; the label only names the row.
    await runScenarios(['supported Server', 'rolled-back Server', 'recovery rejected', 'legacy recovery rejected', 'expired access token', 'Server unavailable', '4009 shutdown', '4001 shutdown', '4009 heartbeat timeout'].map(name => ({ name, run: async () => {
    const sockets: FakeWebSocket[] = []
    const rtc = { close: vi.fn(async () => undefined) }
    const channel = { close: vi.fn(async () => undefined) }
    const cfg = config()
    const server = new HostServerConnection(
      // Backoff draws from [0, maxDelayMs]; keep the window tight so the
      // multi-step recovery scenario rows finish well inside the test timeout.
      { ...cfg, forceRelay: false, reconnect: { ...cfg.reconnect, enabled: true, initialDelayMs: 20, maxDelayMs: 120 } },
      { schemaVersion: 1, deviceId: 'host-rtc', name: 'Host', fingerprint: 'HOST', ...generateKeyPair() },
      { trustedPeer: vi.fn() } as unknown as IdentityStore,
      { baseUrl: 'https://dsh.r2049.cn', authenticate: vi.fn(async () => ({ accessToken: 'access-token' })), refreshCredentials: vi.fn(async () => undefined) } as unknown as HostServerApi,
      { close: vi.fn(async () => undefined) } as unknown as ConnectionController,
      logger(),
      () => { const socket = new FakeWebSocket(); sockets.push(socket); return socket },
      async () => undefined,
    )
    const requests: Array<{ connectionId: string; requestId: string; ticket: string }> = []
    const lease = new ControlLease('connection-rtc', 'ticket', payload => { requests.push(payload) }, () => {})
    lease.start()
    lease.acknowledge({ ...requests[0]!, ticket: 'confirmed', leaseMs: 300_000 })
    try {
      server.start()
      await flush()
      const socket = sockets[0]!
      socket.open()
      socket.receive(createControlFrame('hello.ack', { ...helloAck('control-rtc'), capabilities: ['transport.p2p', 'transport.webrtc.resume.v1'] }))
      await vi.waitFor(() => expect(server.isOnline()).toBe(true))
      const internals = server as unknown as { tunnels: Map<string, unknown> }
      internals.tunnels.set('connection-rtc', { connectionId: 'connection-rtc', transport: 'p2p', rtc, channel, lease })
      if (name === '4009 shutdown') socket.close(4009, 'server shutdown')
      else if (name === '4001 shutdown') socket.close(4001, 'server shutdown')
      else if (name === '4009 heartbeat timeout') socket.close(4009, 'heartbeat timeout')
      else socket.close(1012, 'Server restart')
      await vi.waitFor(() => expect(sockets).toHaveLength(2))
      expect(rtc.close).not.toHaveBeenCalled()
      expect(channel.close).not.toHaveBeenCalled()
      const next = sockets[1]!
      if (name === 'Server unavailable') {
        next.close(1006, 'offline')
        await vi.waitFor(() => expect(sockets).toHaveLength(3))
        expect(rtc.close).not.toHaveBeenCalled()
        expect(channel.close).not.toHaveBeenCalled()
      }
      const reconnect = name === 'Server unavailable' ? sockets[2]! : next
      reconnect.open()
      expect(JSON.parse(reconnect.sent[0]!).payload.recoveryTickets).toEqual(['confirmed'])
      if (name === 'rolled-back Server' || name === 'recovery rejected' || name === 'legacy recovery rejected' || name === 'expired access token') {
        // Keep each row's historical (code, reason) pair: 'legacy recovery
        // rejected' is 4002 + a distinct reason, not a shutdown.
        next.close(name === 'rolled-back Server' ? 4008 : name === 'recovery rejected' ? 4012 : 4002, name === 'legacy recovery rejected' ? 'recovery authorization rejected' : 'rejected')
        await vi.waitFor(() => expect(sockets).toHaveLength(3))
        const legacy = sockets[2]!
        legacy.open()
        if (name === 'expired access token') {
          expect(JSON.parse(legacy.sent[0]!).payload.recoveryTickets).toEqual(['confirmed'])
          expect(rtc.close).not.toHaveBeenCalled()
          legacy.receive(createControlFrame('hello.ack', { ...helloAck('recovered'), capabilities: ['transport.p2p', 'transport.webrtc.resume.v1'] }))
        } else {
          expect(JSON.parse(legacy.sent[0]!).payload.recoveryTickets).toBeUndefined()
          legacy.receive(createControlFrame('hello.ack', helloAck('legacy')))
        }
      } else {
        reconnect.receive(createControlFrame('hello.ack', { ...helloAck('recovered'), capabilities: ['transport.p2p', 'transport.webrtc.resume.v1'] }))
      }
      await vi.waitFor(() => expect(server.isOnline()).toBe(true))
      expect(internals.tunnels.size).toBe(['rolled-back Server', 'recovery rejected', 'legacy recovery rejected'].includes(name) ? 0 : 1)
    } finally {
      await server.stop()
      lease.stop()
    }
    expect(rtc.close).toHaveBeenCalledOnce()
    expect(channel.close).toHaveBeenCalledOnce()
    } })))
  })

  it('backs off the first reconnect after every close into the maxDelayMs window', async () => {
    await runScenarios([
      { name: '4001/server shutdown', code: 4001, reason: 'server shutdown' },
      { name: '4009/server shutdown', code: 4009, reason: 'server shutdown' },
      { name: '4009/heartbeat timeout', code: 4009, reason: 'heartbeat timeout' },
      { name: '1006/network drop', code: 1006, reason: '' },
    ].map(row => ({ name: row.name, run: async () => {
      try {
        const sockets: FakeWebSocket[] = []
        const cfg = config()
        const server = new HostServerConnection(
          // Host reconnect config here is initial 100ms / max 400ms; every
          // close now draws from the full [0, maxDelayMs] window, so the same
          // 0.9 draw waits 360ms regardless of the close reason.
          { ...cfg, forceRelay: false, reconnect: { ...cfg.reconnect, enabled: true, initialDelayMs: 100, maxDelayMs: 400, jitter: 0 } },
          { schemaVersion: 1, deviceId: 'host-shutdown', name: 'Host', fingerprint: 'HOST', ...generateKeyPair() },
          { trustedPeer: vi.fn() } as unknown as IdentityStore,
          { baseUrl: 'https://dsh.r2049.cn', authenticate: vi.fn(async () => ({ accessToken: 'access-token' })) } as unknown as HostServerApi,
          { close: vi.fn(async () => undefined) } as unknown as ConnectionController,
          logger(), () => { const socket = new FakeWebSocket(); sockets.push(socket); return socket }, async () => undefined,
        )
        const random = vi.spyOn(Math, 'random')
        random.mockReturnValue(0.9)
        try {
          server.start()
          await flush()
          sockets[0]!.open()
          sockets[0]!.receive(createControlFrame('hello.ack', helloAck('control-shutdown')))
          await vi.waitFor(() => expect(server.isOnline()).toBe(true))
          sockets[0]!.close(row.code, row.reason)
          // The close handler runs on a later turn; wait for the backoff draw,
          // then assert no socket was created ahead of its timer.
          await vi.waitFor(() => expect(random).toHaveBeenCalled())
          expect(sockets).toHaveLength(1)
          await new Promise(resolve => setTimeout(resolve, 200))
          // 0.9 x 400ms = 360ms: still waiting at 200ms, connected by ~400ms.
          expect(sockets).toHaveLength(1)
          await vi.waitFor(() => expect(sockets).toHaveLength(2), { timeout: 2_000 })
          expect(server.isOnline()).toBe(false)
        } finally { await server.stop() }
      } finally {
        vi.useRealTimers()
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
      }
    } })))
  })

  it('closes retained tunnels and stops retrying when the Server rejects the protocol version', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(1)
    const sockets: FakeWebSocket[] = []
    const rtc = { close: vi.fn(async () => undefined) }
    const channel = { close: vi.fn(async () => undefined) }
    const cfg = config()
    const server = new HostServerConnection(
      { ...cfg, forceRelay: false, reconnect: { ...cfg.reconnect, enabled: true } },
      { schemaVersion: 1, deviceId: 'host-rtc', name: 'Host', fingerprint: 'HOST', ...generateKeyPair() },
      { trustedPeer: vi.fn() } as unknown as IdentityStore,
      { baseUrl: 'https://dsh.r2049.cn', authenticate: vi.fn(async () => ({ accessToken: 'access-token' })) } as unknown as HostServerApi,
      { close: vi.fn(async () => undefined) } as unknown as ConnectionController,
      logger(), () => { const socket = new FakeWebSocket(); sockets.push(socket); return socket }, async () => undefined,
    )
    const requests: Array<{ connectionId: string; requestId: string; ticket: string }> = []
    const lease = new ControlLease('connection-rtc', 'ticket', payload => { requests.push(payload) }, () => {})
    lease.start()
    lease.acknowledge({ ...requests[0]!, ticket: 'confirmed', leaseMs: 300_000 })
    try {
      server.start()
      await vi.advanceTimersByTimeAsync(0)
      sockets[0]!.open()
      sockets[0]!.receive(createControlFrame('hello.ack', { ...helloAck('control-rtc'), capabilities: ['transport.p2p', 'transport.webrtc.resume.v1'] }))
      await vi.advanceTimersByTimeAsync(0)
      expect(server.isOnline()).toBe(true)
      const internals = server as unknown as { tunnels: Map<string, unknown> }
      internals.tunnels.set('connection-rtc', { connectionId: 'connection-rtc', transport: 'p2p', rtc, channel, lease })
      sockets[0]!.close(1012, 'Server restart')
      // Exercise the maximum jitter delay without racing a wall-clock timeout.
      await vi.advanceTimersByTimeAsync(cfg.reconnect.maxDelayMs - 1)
      expect(sockets).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(sockets).toHaveLength(2)
      sockets[1]!.open()
      sockets[1]!.close(4011, 'unsupported protocol version')
      await vi.advanceTimersByTimeAsync(0)
      expect(channel.close).toHaveBeenCalledOnce()
      expect(rtc.close).toHaveBeenCalledOnce()
      expect(internals.tunnels.size).toBe(0)
      expect(server.lastError()).toBe('UNSUPPORTED_VERSION')
      await vi.advanceTimersByTimeAsync(cfg.reconnect.maxDelayMs * 2)
      expect(sockets).toHaveLength(2)
    } finally {
      try { await server.stop(); lease.stop() }
      finally { vi.useRealTimers(); vi.restoreAllMocks() }
    }
  })

  it('keeps an authenticated Relay fallback when the parallel WebRTC negotiation later fails', async () => {
    const keys = generateKeyPair(new Uint8Array(32).fill(16))
    const closeConnection = vi.fn(async () => true)
    const rtc = { close: vi.fn(async () => undefined) }
    const tunnel = {
      connectionId: 'connection-negotiating',
      membershipId: 'membership-negotiating',
      peer: { deviceId: 'client-negotiating' },
      noise: { destroy: vi.fn() },
      transport: 'relay',
      rtc,
      channel: {},
    }
    const server = new HostServerConnection(
      config(),
      { schemaVersion: 1, deviceId: 'host-negotiating', name: 'Host', fingerprint: 'HOST', ...keys },
      { trustedPeer: vi.fn() } as unknown as IdentityStore,
      { baseUrl: 'https://dsh.r2049.cn' } as HostServerApi,
      { closeConnection } as unknown as ConnectionController,
      logger(),
      () => new FakeWebSocket(),
    )
    const internals = server as unknown as {
      tunnels: Map<string, unknown>
      handleRtcFailed(tunnel: unknown, rtc: unknown, error: Error): Promise<void>
    }
    internals.tunnels.set(tunnel.connectionId, tunnel)

    await internals.handleRtcFailed(tunnel, rtc, new Error('negotiation failed'))

    expect(tunnel.transport).toBe('relay')
    expect(tunnel.rtc).toBeUndefined()
    expect(rtc.close).toHaveBeenCalledOnce()
    expect(closeConnection).not.toHaveBeenCalled()
    expect(internals.tunnels.get(tunnel.connectionId)).toBe(tunnel)
    expect(tunnel.channel).toEqual({})
  })

  it('binds Noise replies to WebRTC when Server forwarding delivers the handshake before P2P selection', async () => {
    const hostKeys = generateKeyPair(new Uint8Array(32).fill(17))
    const clientKeys = generateKeyPair(new Uint8Array(32).fill(18))
    const socket = new FakeWebSocket()
    socket.open()
    let accepted: AuthenticatedPeerChannel | undefined
    const connections = {
      accept: vi.fn(async (channel: AuthenticatedPeerChannel) => { accepted = channel }),
    } as unknown as ConnectionController
    const server = new HostServerConnection(
      { ...config(), forceRelay: false },
      { schemaVersion: 1, deviceId: 'host-race', name: 'Host', fingerprint: 'HOST', ...hostKeys },
      {} as IdentityStore,
      {} as HostServerApi,
      connections,
      logger(),
      () => socket,
    )
    const rtcSend = vi.fn(async (_ciphertext: Uint8Array) => undefined)
    const rtc = {
      send: rtcSend,
      close: vi.fn(async () => undefined),
      selectedPathMode: vi.fn(() => 'LAN' as const),
    }
    const tunnel = {
      connectionId: 'connection-race',
      membershipId: 'membership-race',
      peer: {
        deviceId: 'client-race',
        name: 'Client',
        platform: 'linux',
        publicKey: clientKeys.publicKey,
        fingerprint: 'CLIENT',
        trustedAt: 1,
        membershipId: 'membership-race',
      },
      preferredTransports: ['lan', 'p2p', 'turn', 'relay'],
      noise: new NoiseIkSession({
        role: 'responder',
        localPrivateKey: hostKeys.privateKey,
        localPublicKey: hostKeys.publicKey,
        remotePublicKey: clientKeys.publicKey,
        prologue: createNoisePrologue('connection-race', 'host-race', 'client-race'),
      }),
      transport: 'negotiating',
      rtc,
    }
    const internals = server as unknown as {
      socket: FakeWebSocket
      negotiatedCapabilities: string[]
      tunnels: Map<string, unknown>
      handleTransportSelected(payload: unknown): Promise<void>
      handleHandshake(payload: unknown): Promise<void>
    }
    internals.socket = socket
    internals.negotiatedCapabilities = ['transport.lan', 'transport.p2p', 'transport.turn', 'transport.relay']
    internals.tunnels.set(tunnel.connectionId, tunnel)

    const clientNoise = new NoiseIkSession({
      role: 'initiator',
      localPrivateKey: clientKeys.privateKey,
      localPublicKey: clientKeys.publicKey,
      remotePublicKey: hostKeys.publicKey,
      prologue: createNoisePrologue('connection-race', 'host-race', 'client-race'),
    })
    await internals.handleHandshake({
      connectionId: tunnel.connectionId,
      targetDeviceId: 'host-race',
      step: 1,
      data: toBase64Url(clientNoise.writeHandshake()),
    })
    expect(accepted).toBeUndefined()
    expect(socket.sent).toHaveLength(0)

    await internals.handleTransportSelected({
      connectionId: tunnel.connectionId,
      targetDeviceId: 'host-race',
      transport: 'lan',
    })
    expect(tunnel).toMatchObject({ transport: 'lan', transportMode: 'LAN' })
    const handshakeReply = socket.sent.map(frame => JSON.parse(frame))
      .find(frame => frame.type === 'secure.handshake')
    clientNoise.readHandshake(fromBase64UrlForTest(handshakeReply.payload.data))

    const response = createRpcRequest('harness.transport.describe', {})
    await accepted!.send(response)

    expect(accepted?.mode).toBe('LAN')
    expect(rtcSend).toHaveBeenCalledOnce()
    expect(socket.sent.map(frame => JSON.parse(frame)).some(frame => frame.type === 'relay')).toBe(false)
    expect(decodeMessage(clientNoise.decrypt(rtcSend.mock.calls[0]![0]))).toEqual(response)
  })

  it('downgrades a selected LAN path for an older Server without transport.lan', () => {
    const server = new HostServerConnection(
      config(),
      {} as HostIdentity,
      {} as IdentityStore,
      {} as HostServerApi,
      {} as ConnectionController,
      logger(),
    )
    const socket = new FakeWebSocket()
    const rtc = {
      selectedPathMode: vi.fn(() => 'LAN' as const),
      diagnostics: vi.fn(() => undefined),
    }
    const tunnel = {
      connectionId: 'connection-lan-compat',
      peer: { deviceId: 'client-1' },
      noise: { destroy: vi.fn() },
      rtc,
      transport: 'negotiating',
    }
    const internals = server as unknown as {
      socket: FakeWebSocket
      negotiatedCapabilities: string[]
      tunnels: Map<string, unknown>
      handleRtcOpened(value: unknown, transport: 'lan' | 'p2p' | 'turn'): void
    }
    internals.socket = socket
    socket.open()
    internals.negotiatedCapabilities = ['transport.p2p', 'transport.relay']
    internals.tunnels.set(tunnel.connectionId, tunnel)

    internals.handleRtcOpened(tunnel, 'lan')

    expect(tunnel).toMatchObject({ transport: 'p2p' })
    expect(socket.sent.map(frame => JSON.parse(frame))).toContainEqual(expect.objectContaining({
      type: 'transport.selected',
      payload: expect.objectContaining({ transport: 'p2p' }),
    }))
  })

  it('rejects selected transports outside negotiated capabilities', async () => {
    const rows = [
      { negotiated: 'transport.turn', selected: 'p2p' as const, relay: true },
      { negotiated: 'transport.p2p', selected: 'turn' as const, relay: false },
    ] as const
    await runScenarios(
      rows.map((row, index) => {
        const { negotiated, selected, relay } = row
        return {
          name: scenarioName('rejects $selected when only $negotiated was negotiated', row, index),
          run: async () => {
            const server = new HostServerConnection(
              config(),
              {} as HostIdentity,
              {} as IdentityStore,
              {} as HostServerApi,
              {} as ConnectionController,
              logger(),
            )
            const rtc = {
              close: vi.fn(async () => undefined),
              diagnostics: vi.fn(() => undefined),
            }
            const tunnel = {
              connectionId: 'connection-1',
              peer: { deviceId: 'client-1' },
              noise: { destroy: vi.fn() },
              rtc,
              transport: 'negotiating',
            }
            const internals = server as unknown as {
              negotiatedCapabilities: string[]
              tunnels: Map<string, unknown>
              handleRtcOpened(value: unknown, transport: 'lan' | 'p2p' | 'turn'): void
            }
            internals.negotiatedCapabilities = relay ? [negotiated, 'transport.relay'] : [negotiated]
            internals.tunnels.set(tunnel.connectionId, tunnel)

            internals.handleRtcOpened(tunnel, selected)
            await flush()

            expect(rtc.close).toHaveBeenCalledOnce()
            if (relay) {
              expect(tunnel).toMatchObject({ transport: 'relay', rtc: undefined })
            } else {
              expect(internals.tunnels.has(tunnel.connectionId)).toBe(false)
              expect(tunnel.noise.destroy).toHaveBeenCalledOnce()
            }
          },
        }
      }),
    )
  })
})

function helloAck(connectionSessionId: string) {
  return {
    protocol: 1,
    serverVersion: '0.1.0',
    connectionSessionId,
    heartbeatIntervalMs: 25_000,
    maxControlFrameBytes: 65_536,
    maxRelayFrameBytes: 1_048_576,
  }
}

function config(): ResolvedConfig {
  return {
    iceIpv6: false,
    terminal: { enabled: false },
    httpServerAllowlist: [],
    sidebar: { entry: 'standard' },
    loopback: { ports: [] },
    enabled: true,
    role: 'host',
    serverUrl: 'https://dsh.r2049.cn',
    deviceName: 'Host',
    forceRelay: true,
    rotatePinnedPeerKey: false,
    logLevel: 'error',
    reconnect: { enabled: false, initialDelayMs: 100, maxDelayMs: 1_000, jitter: 0 },
    codex: { enabled: false, binary: 'codex' },
    cursor: { enabled: false, binary: 'agent' },
  }
}

function logger(): SafeLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SafeLogger
}

function fromBase64UrlForTest(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/'), 'base64'))
}

async function flush(): Promise<void> { await new Promise(resolve => setTimeout(resolve, 0)) }

describe('pinned peer identity rotation', () => {
  const OLD_KEY = generateKeyPair(new Uint8Array(32).fill(61)).publicKey
  const NEW_KEY = generateKeyPair(new Uint8Array(32).fill(62)).publicKey
  const stalePin: TrustedPeer = {
    deviceId: 'client-1',
    name: 'Phone',
    platform: 'android',
    publicKey: OLD_KEY,
    fingerprint: 'STALE',
    trustedAt: 1,
    membershipId: 'membership-1',
  }

  async function rotationHarness(opts: { rotate: boolean; descriptorMembershipId?: string }) {
    const peer = { ...stalePin, publicKey: NEW_KEY }
    const socket = new FakeWebSocket()
    const api = {
      baseUrl: 'https://dsh.r2049.cn',
      authenticate: vi.fn(async () => ({ accessToken: 'access-token-value' })),
      refreshCredentials: vi.fn(),
      deviceFor: vi.fn(async () => ({
        deviceId: peer.deviceId,
        name: peer.name,
        role: 'client',
        platform: peer.platform,
        identityKey: peer.publicKey,
        membershipId: opts.descriptorMembershipId ?? peer.membershipId!,
      })),
    } as unknown as HostServerApi
    const trustPeer = vi.fn(async (input: Omit<TrustedPeer, 'fingerprint' | 'trustedAt'>) => ({
      ...input,
      fingerprint: 'ROTATED',
      trustedAt: 2,
    }))
    const connections = {
      accept: vi.fn(async () => undefined),
      closeConnection: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } as unknown as ConnectionController
    const identity = { schemaVersion: 1, deviceId: 'host-1', name: 'Host', fingerprint: 'HOST',
      ...generateKeyPair(new Uint8Array(32).fill(51)) } as unknown as HostIdentity
    const resolvedConfig = { ...config(), rotatePinnedPeerKey: opts.rotate } as ResolvedConfig
    const server = new HostServerConnection(
      resolvedConfig,
      identity,
      { trustedPeer: vi.fn(() => stalePin), trustPeer } as unknown as IdentityStore,
      api,
      connections,
      logger(),
      () => socket,
      undefined,
      () => ['harness.api.v1'],
      '0.1.0-rc.8',
    )
    server.start()
    await flush()
    socket.open()
    await flush()
    socket.receive(createControlFrame('hello.ack', {
      protocol: 1,
      serverVersion: '0.1.0',
      connectionSessionId: 'control-1',
      heartbeatIntervalMs: 25_000,
      maxControlFrameBytes: 65_536,
      maxRelayFrameBytes: 1_048_576,
      capabilities: ['transport.relay'],
    }))
    await flush()
    socket.receive(createControlFrame('connect.incoming', {
      connectionId: 'connection-rotation',
      clientDeviceId: 'client-1',
      clientIdentityKey: NEW_KEY,
      authorization: 'account',
      preferredTransports: ['relay'],
    }))
    await flush()
    const types = socket.sent.map(frame => (JSON.parse(frame) as { type?: string }).type)
    return { trustPeer, types }
  }

  it('rejects a stale pinned peer key by default', async () => {
    const { trustPeer, types } = await rotationHarness({ rotate: false })
    expect(types).toContain('connect.rejected')
    expect(types).not.toContain('connect.accepted')
    expect(trustPeer).not.toHaveBeenCalled()
  })

  it('rotates the stale pin for the same membership when opted in', async () => {
    const { trustPeer, types } = await rotationHarness({ rotate: true })
    expect(types).not.toContain('connect.rejected')
    expect(types).toContain('connect.accepted')
    expect(trustPeer).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'client-1',
      publicKey: NEW_KEY,
      membershipId: 'membership-1',
    }))
  })

  it('still rejects cross-membership rotation attempts', async () => {
    const { trustPeer, types } = await rotationHarness({ rotate: true, descriptorMembershipId: 'membership-OTHER' })
    expect(types).toContain('connect.rejected')
    expect(types).not.toContain('connect.accepted')
    expect(trustPeer).not.toHaveBeenCalled()
  })
})

it('reconnects after temporary 1013 handshakes without spending another credential refresh', async () => {
  await runScenarios([
    { name: 'temporary failures before authentication recovery', closes: [1013, 1013, 4002] },
    { name: 'temporary failures after authentication recovery', closes: [4002, 1013, 1013] },
    { name: 'only temporary failures', closes: [1013, 1013] },
  ].map(row => ({ name: row.name, run: async () => {
    const sockets: FakeWebSocket[] = []
    let accessToken = 'old-access-value'
    const api = {
      baseUrl: 'https://dsh.r2049.cn',
      authenticate: vi.fn(async () => ({ accessToken })),
      refreshCredentials: vi.fn(async () => { accessToken = 'new-access-value' }),
      clearAuthorization: vi.fn(),
    }
    const server = new HostServerConnection(
      { ...config(), reconnect: { enabled: true, initialDelayMs: 1, maxDelayMs: 1, jitter: 0 } },
      { schemaVersion: 1, deviceId: 'host-temporary', name: 'Host', fingerprint: 'HOST', ...generateKeyPair() },
      {} as IdentityStore, api as unknown as HostServerApi,
      { close: vi.fn(async () => undefined) } as unknown as ConnectionController,
      logger(), () => { const socket = new FakeWebSocket(); sockets.push(socket); return socket },
    )
    try {
      server.start()
      for (const [index, code] of row.closes.entries()) {
        await vi.waitFor(() => expect(sockets).toHaveLength(index + 1))
        sockets[index]!.open()
        sockets[index]!.close(code)
      }
      await vi.waitFor(() => expect(sockets).toHaveLength(row.closes.length + 1))
      const last = sockets.at(-1)!
      last.open()
      expect(JSON.parse(last.sent[0]!).payload.accessToken).toBe(accessToken)
      last.receive(createControlFrame('hello.ack', helloAck('recovered-after-startup')))
      await vi.waitFor(() => expect(server.isOnline()).toBe(true))
      expect(api.refreshCredentials).toHaveBeenCalledTimes(row.closes.filter(code => code === 4002).length)
      expect(api.clearAuthorization).not.toHaveBeenCalled()
      expect(server.lastError()).toBeUndefined()
    } finally { await server.stop() }
  } })))
})

it('keeps reconnecting through non-protocol gateway 401 responses and becomes online after recovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-connection-gateway-'))
  let server: HostServerConnection | undefined
  try {
    const identity: HostIdentity = {
      schemaVersion: 1, deviceId: 'host-gateway', name: 'Host', fingerprint: 'HOST', ...generateKeyPair(),
    }
    const store = new ServerCredentialStore(directory)
    const initial = await store.save({
      serverUrl: 'https://dsh.r2049.cn', deviceId: identity.deviceId, authorizationMethod: 'account',
      accessToken: 'old-access-token-value', accessTokenExpiresAt: Date.now() - 1,
      refreshToken: 'old-refresh-token-value', refreshTokenExpiresAt: Date.now() + 86400000,
    })
    const responses = [
      new Response('<html>gateway challenge</html>', { status: 401 }),
      new Response('', { status: 401 }),
      new Response('{"detail":"gateway startup"}', { status: 401 }),
      new Response(JSON.stringify({
        accessToken: 'recovered-access-token', accessTokenExpiresAt: Date.now() + 600000,
        refreshToken: 'recovered-refresh-token', refreshTokenExpiresAt: initial.refreshTokenExpiresAt,
      }), { status: 200 }),
    ]
    const fetcher = vi.fn(async () => {
      expect(await store.load('https://dsh.r2049.cn', identity.deviceId)).toEqual(initial)
      return responses.shift()!
    })
    const api = new HostServerApi('https://dsh.r2049.cn', store, fetcher)
    const sockets: FakeWebSocket[] = []
    const logs = logger()
    server = new HostServerConnection(
      { ...config(), reconnect: { enabled: true, initialDelayMs: 1, maxDelayMs: 1, jitter: 0 } },
      identity, {} as IdentityStore, api,
      { close: vi.fn(async () => undefined) } as unknown as ConnectionController,
      logs, () => { const socket = new FakeWebSocket(); sockets.push(socket); return socket },
    )
    server.start()
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0]!.open()
    expect(JSON.parse(sockets[0]!.sent[0]!).payload.accessToken).toBe('recovered-access-token')
    sockets[0]!.receive(createControlFrame('hello.ack', helloAck('gateway-recovered')))
    await vi.waitFor(() => expect(server!.isOnline()).toBe(true))
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(responses).toHaveLength(0)
    expect(logs.warn).not.toHaveBeenCalledWith('server control connection failed', expect.objectContaining({ code: 'AUTH_INVALID' }))
    expect((await store.load('https://dsh.r2049.cn', identity.deviceId))?.refreshToken).toBe('recovered-refresh-token')
  } finally {
    await server?.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

it('reconnects when the control WebSocket goes silent beyond 3x heartbeatIntervalMs, even on a half-open socket', async () => {
  vi.useFakeTimers()
  const sockets: FakeWebSocket[] = []
  const logs = logger()
  const api = {
    baseUrl: 'https://dsh.r2049.cn',
    authenticate: vi.fn(async () => ({ accessToken: 'access-token' })),
  } as unknown as HostServerApi
  const server = new HostServerConnection(
    { ...config(), reconnect: { enabled: true, initialDelayMs: 10, maxDelayMs: 100, jitter: 0 } },
    { schemaVersion: 1, deviceId: 'host-watchdog', name: 'Host', fingerprint: 'HOST', ...generateKeyPair() },
    { trustedPeer: () => undefined } as unknown as IdentityStore,
    api,
    { close: vi.fn(async () => undefined) } as unknown as ConnectionController,
    logs,
    () => {
      const socket = new FakeWebSocket()
      // Simulate a half-open TCP socket where close() does not fire onclose on its own.
      socket.close = vi.fn(() => { socket.readyState = 2 })
      sockets.push(socket)
      return socket
    },
  )
  try {
    server.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(sockets).toHaveLength(1)
    sockets[0]!.open()
    sockets[0]!.receive(createControlFrame('hello.ack', helloAck('watchdog-1')))
    await vi.advanceTimersByTimeAsync(0)
    expect(server.isOnline()).toBe(true)

    // Pings arriving inside the 75s window reset the silence watchdog.
    await vi.advanceTimersByTimeAsync(50_000)
    sockets[0]!.receive(createControlFrame('ping', { nonce: 'n-1' }))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(50_000)
    expect(server.isOnline()).toBe(true)
    expect(sockets).toHaveLength(1)

    // Silence reaching 75_000ms after the last frame triggers close + reconnect.
    await vi.advanceTimersByTimeAsync(25_000)
    expect(logs.warn).toHaveBeenCalledWith(
      'server control heartbeat timeout; reconnecting',
      expect.objectContaining({ heartbeatIntervalMs: 25_000 }),
    )
    expect(server.isOnline()).toBe(false)

    await vi.advanceTimersByTimeAsync(200)
    expect(sockets).toHaveLength(2)
    sockets[1]!.open()
    sockets[1]!.receive(createControlFrame('hello.ack', helloAck('watchdog-2')))
    await vi.advanceTimersByTimeAsync(0)
    expect(server.isOnline()).toBe(true)
  } finally {
    await server.stop()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
    vi.restoreAllMocks()
  }
})

it('completes watchdog reconnect and stop even when an async control frame handler is stalled, and ignores late completion', async () => {
  vi.useFakeTimers()
  const sockets: FakeWebSocket[] = []
  let resolveDeviceLookup: ((value: unknown) => void) | undefined
  const api = {
    baseUrl: 'https://dsh.r2049.cn',
    authenticate: vi.fn(async () => ({ accessToken: 'access-token' })),
    deviceFor: vi.fn(() => new Promise(resolve => { resolveDeviceLookup = resolve })),
  } as unknown as HostServerApi
  const server = new HostServerConnection(
    { ...config(), reconnect: { enabled: true, initialDelayMs: 10, maxDelayMs: 100, jitter: 0 } },
    { schemaVersion: 1, deviceId: 'host-stalled', name: 'Host', fingerprint: 'HOST', ...generateKeyPair() },
    { trustedPeer: () => undefined } as unknown as IdentityStore,
    api,
    { close: vi.fn(async () => undefined) } as unknown as ConnectionController,
    logger(),
    () => {
      const socket = new FakeWebSocket()
      socket.close = vi.fn(() => { socket.readyState = 2 })
      sockets.push(socket)
      return socket
    },
  )
  try {
    server.start()
    await vi.advanceTimersByTimeAsync(0)
    sockets[0]!.open()
    sockets[0]!.receive(createControlFrame('hello.ack', helloAck('stalled-1')))
    await vi.advanceTimersByTimeAsync(0)
    expect(server.isOnline()).toBe(true)

    // Start an async connect.incoming handler whose deviceFor lookup never resolves yet.
    const clientKeys = generateKeyPair()
    sockets[0]!.receive(createControlFrame('connect.incoming', {
      connectionId: 'conn-stalled-1',
      clientDeviceId: 'client-stalled-1',
      clientIdentityKey: clientKeys.publicKey,
      authorization: 'account',
      preferredTransports: ['relay'],
    }))
    await vi.advanceTimersByTimeAsync(0)
    expect(api.deviceFor).toHaveBeenCalledTimes(1)

    // Also simulate a lease callback setting readyState = 2 (CLOSING) without firing onclose.
    sockets[0]!.readyState = 2

    // Watchdog expiry still settles the half-open/CLOSING socket and reconnects despite the stalled handler.
    await vi.advanceTimersByTimeAsync(75_000)
    expect(server.isOnline()).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(sockets).toHaveLength(2)
    sockets[1]!.open()
    sockets[1]!.receive(createControlFrame('hello.ack', helloAck('stalled-2')))
    await vi.advanceTimersByTimeAsync(0)
    expect(server.isOnline()).toBe(true)

    // Late resolution of the old socket's stalled deviceFor lookup must not send frames on sockets[1].
    const sentBefore = sockets[1]!.sent.length
    resolveDeviceLookup?.({
      deviceId: 'client-stalled-1',
      role: 'client',
      name: 'Client',
      platform: 'android',
      identityKey: clientKeys.publicKey,
      membershipId: 'membership-1',
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(sockets[1]!.sent).toHaveLength(sentBefore)
    expect(server.isOnline()).toBe(true)

    // Wire a real ControlLease onto an active tunnel and verify its heartbeat-expiry
    // callback path when socket.close() rejects non-WHATWG codes (like 1012) and
    // sets readyState = 2 (CLOSING) without emitting onclose.
    let closedCode: number | undefined
    const terminated = vi.fn()
    ;(sockets[1] as unknown as { terminate: () => void }).terminate = terminated
    sockets[1]!.close = vi.fn((code?: number) => {
      if (code !== undefined && code !== 1000 && (code < 3000 || code > 4999)) {
        throw new Error('InvalidAccessError: close code out of range')
      }
      closedCode = code
      sockets[1]!.readyState = 2
    })
    const hostKeys = (server as unknown as { identity: { privateKey: string; publicKey: string; deviceId: string } }).identity
    const responder = new NoiseIkSession({
      role: 'responder',
      localPrivateKey: hostKeys.privateKey,
      localPublicKey: hostKeys.publicKey,
      remotePublicKey: clientKeys.publicKey,
      prologue: createNoisePrologue('conn-lease-1', hostKeys.deviceId, 'client-stalled-1'),
    })
    const initiator = new NoiseIkSession({
      role: 'initiator',
      localPrivateKey: clientKeys.privateKey,
      localPublicKey: clientKeys.publicKey,
      remotePublicKey: hostKeys.publicKey,
      prologue: createNoisePrologue('conn-lease-1', hostKeys.deviceId, 'client-stalled-1'),
    })
    const internals = server as unknown as {
      lastActiveAt?: number
      negotiatedCapabilities: string[]
      tunnels: Map<string, unknown>
      connections: { accept: ReturnType<typeof vi.fn> }
      completeHandshake(tunnel: unknown, payload: unknown): Promise<void>
    }
    internals.connections.accept = vi.fn(async () => undefined)
    internals.negotiatedCapabilities = ['transport.relay', 'transport.webrtc.resume']
    const leaseTunnel = {
      connectionId: 'conn-lease-1',
      membershipId: 'membership-1',
      peer: { deviceId: 'client-stalled-1', publicKey: clientKeys.publicKey },
      noise: responder,
      rtc: { send: vi.fn(async () => undefined), close: vi.fn(async () => undefined) },
      transport: 'p2p',
      recoveryTicket: 'lease-ticket-1',
    }
    internals.tunnels.set('conn-lease-1', leaseTunnel)
    await internals.completeHandshake(leaseTunnel, {
      connectionId: 'conn-lease-1',
      targetDeviceId: hostKeys.deviceId,
      step: 1,
      data: toBase64Url(initiator.writeHandshake()),
    })
    expect(leaseTunnel).toHaveProperty('lease')
    internals.lastActiveAt = Date.now() - 80_000
    ;(leaseTunnel as unknown as { lease: { tick(force?: boolean): void } }).lease.tick(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(closedCode).toBe(4009)
    expect(terminated).toHaveBeenCalledTimes(1)
    expect(sockets[1]!.onopen).toBeNull()
    expect(sockets[1]!.onmessage).toBeNull()
    expect(sockets[1]!.onerror).toBeTypeOf('function')
    expect(server.isOnline()).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(sockets).toHaveLength(3)
    sockets[2]!.open()
    sockets[2]!.receive(createControlFrame('hello.ack', helloAck('stalled-3')))
    await vi.advanceTimersByTimeAsync(0)
    expect(server.isOnline()).toBe(true)
    initiator.destroy()
  } finally {
    await server.stop()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
    vi.restoreAllMocks()
  }
})

it('automatically recovers from a stalled CONNECTING upgrade or stalled 4002 credential refresh, and disposes late-opening abandoned sockets', async () => {
  vi.useFakeTimers()
  const sockets: FakeWebSocket[] = []
  let resolveRefresh: (() => void) | undefined
  let resolveSlowLookup: ((value: unknown) => void) | undefined
  const api = {
    baseUrl: 'https://dsh.r2049.cn',
    authenticate: vi.fn(async () => ({ accessToken: 'access-token' })),
    refreshCredentials: vi.fn(() => new Promise<void>(resolve => { resolveRefresh = resolve })),
    deviceFor: vi.fn(() => new Promise(resolve => { resolveSlowLookup = resolve })),
  } as unknown as HostServerApi
  const server = new HostServerConnection(
    { ...config(), reconnect: { enabled: true, initialDelayMs: 10, maxDelayMs: 100, jitter: 0 } },
    { schemaVersion: 1, deviceId: 'host-cancel', name: 'Host', fingerprint: 'HOST', ...generateKeyPair() },
    {
      trustedPeer: () => undefined,
      trustPeer: vi.fn(async (input: Record<string, unknown>) => ({ ...input, fingerprint: 'CLIENT', trustedAt: 1 })),
    } as unknown as IdentityStore,
    api,
    { close: vi.fn(async () => undefined) } as unknown as ConnectionController,
    logger(),
    () => {
      const socket = new FakeWebSocket()
      if (sockets.length === 0) {
        // First socket remains stuck in CONNECTING (readyState 0) and throws on close() while CONNECTING,
        // but succeeds once readyState transitions to OPEN (1).
        const originalClose = socket.close.bind(socket)
        socket.close = vi.fn((code?: number, reason?: string) => {
          if (socket.readyState === 0) throw new Error('closing while CONNECTING')
          originalClose(code, reason)
        })
      }
      sockets.push(socket)
      return socket
    },
  )
  try {
    server.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(sockets).toHaveLength(1)

    // Without any manual reconnect(), the 30_000ms upgrade deadline automatically
    // abandons the stalled CONNECTING socket and opens a replacement socket.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(sockets[0]!.onopen).toBeTypeOf('function')
    await vi.advanceTimersByTimeAsync(200)
    expect(sockets).toHaveLength(2)

    // Establish the second socket, then let the abandoned first socket finish opening:
    // the disposal onopen handler must immediately close sockets[0] (readyState -> 3)
    // and produce no sends, timers, or state changes on sockets[1].
    sockets[1]!.open()
    sockets[1]!.receive(createControlFrame('hello.ack', helloAck('cancel-2')))
    await vi.advanceTimersByTimeAsync(0)
    expect(server.isOnline()).toBe(true)
    const sentOnSecond = sockets[1]!.sent.length
    sockets[0]!.open()
    expect(sockets[0]!.readyState).toBe(3)
    expect(sockets[0]!.onopen).toBeNull()
    expect(sockets[1]!.sent).toHaveLength(sentOnSecond)

    // Close sockets[1] with 4002 so handleClose enters pending refreshCredentials.
    // Without calling reconnect(), the 15_000ms refresh timeout automatically settles
    // and reconnects onto sockets[2].
    sockets[1]!.close(4002, 'expired token')
    await vi.advanceTimersByTimeAsync(60)
    expect(api.refreshCredentials).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(15_000)
    await vi.advanceTimersByTimeAsync(200)
    expect(sockets).toHaveLength(3)
    sockets[2]!.open()
    sockets[2]!.receive(createControlFrame('hello.ack', helloAck('cancel-3')))
    await vi.advanceTimersByTimeAsync(0)
    expect(server.isOnline()).toBe(true)

    // Resolving the old refresh promise afterward must not mutate authRecoveryAttempted on the live connection.
    resolveRefresh?.()
    await vi.advanceTimersByTimeAsync(0)
    expect((server as unknown as { authRecoveryAttempted: boolean }).authRecoveryAttempted).toBe(false)

    // Verify that on a natural close, even if a preceding handler stays stalled beyond
    // the 50ms drain window, a queued terminal error (UNSUPPORTED_VERSION) is still
    // recorded and stops automatic retries.
    const clientKeys = generateKeyPair()
    sockets[2]!.receive(createControlFrame('connect.incoming', {
      connectionId: 'conn-drain-1',
      clientDeviceId: 'client-drain-1',
      clientIdentityKey: clientKeys.publicKey,
      authorization: 'account',
      preferredTransports: ['relay'],
    }))
    sockets[2]!.receive(createControlFrame('error', {
      code: 'UNSUPPORTED_VERSION',
      message: 'unsupported version',
      retryable: false,
    }))
    sockets[2]!.close(1000, 'closing after terminal error')
    await vi.advanceTimersByTimeAsync(200)
    expect(server.lastError()).toBe('UNSUPPORTED_VERSION')
    expect(server.isReconnecting()).toBe(false)
    expect(sockets).toHaveLength(3)
    resolveSlowLookup?.({
      deviceId: 'client-drain-1',
      role: 'client',
      name: 'Client',
      platform: 'android',
      identityKey: clientKeys.publicKey,
      membershipId: 'membership-1',
    })
    await vi.advanceTimersByTimeAsync(0)
  } finally {
    await server.stop()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
    vi.restoreAllMocks()
  }
})

it('stops sending remaining fragments when a relay tunnel is dropped mid-send', async () => {
  const hostKeys = generateKeyPair(new Uint8Array(32).fill(71))
  const clientKeys = generateKeyPair(new Uint8Array(32).fill(72))
  const socket = new FakeWebSocket()
  socket.open()
  let accepted: AuthenticatedPeerChannel | undefined
  const server = new HostServerConnection(
    config(),
    { schemaVersion: 1, deviceId: 'host-frag', name: 'Host', fingerprint: 'HOST', ...hostKeys },
    { trustedPeer: () => undefined } as unknown as IdentityStore,
    { baseUrl: 'https://dsh.r2049.cn' } as HostServerApi,
    {
      accept: vi.fn(async (ch: AuthenticatedPeerChannel) => { accepted = ch }),
      closeConnection: vi.fn(async () => false),
      close: vi.fn(async () => undefined),
    } as unknown as ConnectionController,
    logger(),
    () => socket,
  )
  const noise = new NoiseIkSession({
    role: 'responder',
    localPrivateKey: hostKeys.privateKey,
    localPublicKey: hostKeys.publicKey,
    remotePublicKey: clientKeys.publicKey,
    prologue: createNoisePrologue('connection-frag', 'host-frag', 'client-frag'),
  })
  const initiator = new NoiseIkSession({
    role: 'initiator',
    localPrivateKey: clientKeys.privateKey,
    localPublicKey: clientKeys.publicKey,
    remotePublicKey: hostKeys.publicKey,
    prologue: createNoisePrologue('connection-frag', 'host-frag', 'client-frag'),
  })
  const tunnel = {
    connectionId: 'connection-frag',
    membershipId: 'membership-frag',
    peer: { deviceId: 'client-frag', publicKey: clientKeys.publicKey },
    noise,
    transport: 'relay',
  }
  const internals = server as unknown as {
    socket: FakeWebSocket
    tunnels: Map<string, unknown>
    completeHandshake(tunnel: unknown, payload: unknown): Promise<void>
    dropTunnel(id: string, code?: string): Promise<void>
  }
  internals.socket = socket
  internals.tunnels.set('connection-frag', tunnel)
  let relaySent = 0
  socket.onSend = frame => {
    if ((frame as { type?: unknown }).type === 'relay') {
      relaySent += 1
      if (relaySent === 1) void internals.dropTunnel('connection-frag', 'CONNECTION_FAILED')
    }
  }
  try {
    await internals.completeHandshake(tunnel, {
      connectionId: 'connection-frag',
      targetDeviceId: 'host-frag',
      step: 1,
      data: toBase64Url(initiator.writeHandshake()),
    })
    const largePayload = 'x'.repeat(200_000)
    await expect(
      accepted!.send(createRpcRequest('harness.api.call', { method: 'host.describe', rpcId: 'big-1', payload: { text: largePayload } })),
    ).rejects.toThrow(/Relay tunnel closed|Secure channel closed/)
    expect(relaySent).toBe(1)
  } finally {
    initiator.destroy()
    await server.stop()
  }
})
