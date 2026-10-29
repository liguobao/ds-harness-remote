import { runScenarios, scenarioName } from '../../../scripts/test-scenarios.mjs'
import { NoiseIkSession, createNoisePrologue, generateKeyPair, toBase64Url } from '@dsh-remote/crypto'
import { createControlFrame, createRpcRequest, decodeMessage, encodeMessage, type RemoteMessage } from '@dsh-remote/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionController } from '../src/connection-controller.js'
import type { ResolvedConfig } from '../src/config.js'
import type { HostIdentity, IdentityStore, TrustedPeer } from '../src/identity-store.js'
import type { SafeLogger } from '../src/logging.js'
import { ServerApiError, type HostServerApi } from '../src/server-api.js'
import { HostServerConnection } from '../src/server-connection.js'
import type { AuthenticatedPeerChannel } from '../src/types.js'
import { PLUGIN_VERSION } from '../src/version.js'
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
        capabilities: ['transport.relay', 'harness.api.v1', 'fileviewer.read.v1'],
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
      'reject-again',
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
            const api = {
              baseUrl: 'https://dsh.r2049.cn',
              authenticate: vi.fn(async () => ({
                accessToken: sockets.length === 0 ? 'old-access-value' : 'new-access-value',
              })),
              refreshCredentials: vi.fn(async () => {
                if (scenario === 'refresh-rejected')
                  throw new ServerApiError('AUTH_INVALID', 'refresh rejected', false, 401, 'credential_refresh')
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
              } else {
                sockets[0]!.close(scenario.startsWith('replaced') ? 4003 : scenario === 'revoked' ? 4004 : 4002)
              }
              await flush()
              if (scenario === 'recover' || scenario === 'reject-again') {
                expect(sockets).toHaveLength(2)
                expect(api.refreshCredentials).toHaveBeenCalledWith('old-access-value')
                sockets[1]!.open()
                expect(JSON.parse(sockets[1]!.sent[0]!).payload.accessToken).toBe('new-access-value')
                if (scenario === 'recover') {
                  sockets[1]!.receive(createControlFrame('hello.ack', helloAck('control-recovered')))
                  await flush()
                  expect(server.isOnline()).toBe(true)
                  expect(server.lastError()).toBeUndefined()
                } else {
                  sockets[1]!.close(4002)
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
    const rows = ['RATE_LIMITED', 'CONNECTION_FAILED'] as const
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
    terminal: { enabled: false },
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
