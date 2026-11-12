import { runScenarios, scenarioName } from '../../../scripts/test-scenarios.mjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createControlFrame } from '@dsh-remote/protocol'
import {
  AdaptiveTransport,
  RelayTransport,
  RtcDataChannelTransport,
  type AdaptiveTransportOptions,
  type RtcPeerConnectionFactory,
} from '../src/index.js'

class FakeWebSocket {
  static readonly OPEN = 1
  static latest?: FakeWebSocket
  static instances: FakeWebSocket[] = []
  readyState = 0
  binaryType = ''
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string | ArrayBuffer | Blob }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.latest = this
    FakeWebSocket.instances.push(this)
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  receive(value: unknown): void {
    this.receiveRaw(JSON.stringify(value))
  }

  receiveRaw(data: string | ArrayBuffer | Blob): void {
    this.onmessage?.({ data })
  }

  send(value: string): void {
    this.sent.push(value)
  }

  close(): void {
    this.readyState = 3
  }
}

const cleanupScenario1 = () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  FakeWebSocket.latest = undefined
  FakeWebSocket.instances = []
}
afterEach(cleanupScenario1)

describe('RelayTransport control handshake', () => {
  it('attaches an independent data socket when the Server assigns one', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const transport = new RelayTransport('wss://remote.example/ws/v1/connect', {
      role: 'client', deviceId: 'client-1', accessToken: 'access-token', targetDeviceId: 'host-1',
    })
    const connecting = transport.connect()
    const control = FakeWebSocket.latest!
    control.open()
    control.receive(helloAck({ capabilities: ['transport.relay', 'transport.relay.attach'] }))
    await Promise.resolve()
    control.receive(createControlFrame('connect.accepted', {
      connectionId: 'connection-1',
      relayEndpoint: 'wss://relay.example/ws',
      relayTicket: 'dshrt.payload.signature',
      relayNodeId: 'relay-1',
      relayEpoch: 4,
    }))
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2))
    const data = FakeWebSocket.instances[1]!
    data.open()
    expect(JSON.parse(data.sent[0]!)).toMatchObject({
      type: 'relay.attach',
      payload: { connectionId: 'connection-1', deviceId: 'client-1', peerDeviceId: 'host-1', ticket: 'dshrt.payload.signature' },
    })
    data.receive({ v: 1, id: 'ready', type: 'relay.ready', timestamp: Date.now(), payload: { connectionId: 'connection-1', epoch: 4 } })
    await connecting
    await transport.sendHandshake(1, new Uint8Array([1, 2, 3]))
    await transport.send(new TextEncoder().encode('encrypted-frame'))
    expect(control.sent.filter(frame => JSON.parse(frame).type === 'secure.handshake')).toHaveLength(1)
    expect(JSON.parse(data.sent[1]!)).toMatchObject({ type: 'relay', payload: { connectionId: 'connection-1', targetDeviceId: 'host-1', counter: 0 } })
    expect(control.sent.filter(frame => JSON.parse(frame).type === 'relay')).toHaveLength(0)
  })

  it('waits for authorization and sends canonical relay frames', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const transport = new RelayTransport('wss://remote.example/ws/v1/connect', {
      role: 'client',
      deviceId: 'client-1',
      accessToken: 'access-token',
      targetDeviceId: 'host-1',
    })
    let connected = false
    const connecting = transport.connect().then(() => { connected = true })
    const socket = FakeWebSocket.latest!
    socket.open()

    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      v: 1,
      type: 'hello',
      payload: { role: 'client', deviceId: 'client-1', accessToken: 'access-token', protocols: [1] },
    })
    expect(connected).toBe(false)

    socket.receive(createControlFrame('hello.ack', {
      protocol: 1,
      serverVersion: '0.1.0',
      connectionSessionId: 'control-1',
      heartbeatIntervalMs: 25_000,
      maxControlFrameBytes: 65_536,
      maxRelayFrameBytes: 1_048_576,
      capabilities: ['transport.relay'],
    }))
    await Promise.resolve()
    expect(JSON.parse(socket.sent[1]!)).toMatchObject({
      v: 1,
      type: 'connect.request',
      payload: { hostDeviceId: 'host-1', preferredTransports: ['relay'] },
    })
    expect(connected).toBe(false)

    socket.receive(createControlFrame('connect.accepted', {
      connectionId: 'connection-1',
    }))
    await connecting
    expect(transport.connectionInfo()).toEqual({
      connectionId: 'connection-1',
      localDeviceId: 'client-1',
      remoteDeviceId: 'host-1',
    })
    await transport.sendHandshake(1, new Uint8Array([1, 2, 3]))
    await transport.send(new TextEncoder().encode('encrypted-frame'))

    expect(JSON.parse(socket.sent[2]!)).toMatchObject({
      type: 'secure.handshake',
      payload: { connectionId: 'connection-1', targetDeviceId: 'host-1', step: 1, data: 'AQID' },
    })
    const relay = JSON.parse(socket.sent[3]!)
    expect(relay).toMatchObject({
      v: 1,
      type: 'relay',
      payload: { connectionId: 'connection-1', targetDeviceId: 'host-1', counter: 0 },
    })
    expect(relay.payload.ciphertext).not.toContain('encrypted-frame')
  })

  it('rejects a capability that the Client did not offer', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const transport = new RelayTransport('wss://remote.example/ws/v1/connect', {
      role: 'client',
      deviceId: 'client-1',
      accessToken: 'access-token',
      targetDeviceId: 'host-1',
    })
    const connecting = transport.connect()
    const socket = FakeWebSocket.latest!
    socket.open()
    socket.receive(createControlFrame('hello.ack', {
      protocol: 1,
      serverVersion: '0.1.0',
      connectionSessionId: 'control-1',
      heartbeatIntervalMs: 25_000,
      maxControlFrameBytes: 65_536,
      maxRelayFrameBytes: 1_048_576,
      capabilities: ['transport.p2p'],
    }))
    await expect(connecting).rejects.toThrow('did not offer')
  })

  it('enforces the negotiated Relay limit before updating send statistics', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const transport = new RelayTransport('wss://remote.example/ws/v1/connect', {
      role: 'client',
      deviceId: 'client-1',
      accessToken: 'access-token',
      targetDeviceId: 'host-1',
    })
    const connecting = transport.connect()
    const socket = FakeWebSocket.latest!
    socket.open()
    socket.receive(helloAck({
      capabilities: ['transport.relay'],
      maxRelayFrameBytes: 180,
    }))
    await Promise.resolve()
    socket.receive(createControlFrame('connect.accepted', { connectionId: 'connection-1' }))
    await connecting

    await expect(transport.send(new Uint8Array(256))).rejects.toThrow('Relay frame exceeds')
    expect(transport.getStats().bytesSent).toBe(0)
  })

  it('rejects binary Control frames before decoding them', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const transport = new RelayTransport('wss://remote.example/ws/v1/connect', {
      role: 'client',
      deviceId: 'client-1',
      accessToken: 'access-token',
      targetDeviceId: 'host-1',
    })
    const connecting = transport.connect()
    const socket = FakeWebSocket.latest!
    socket.open()
    socket.receiveRaw(new ArrayBuffer(2 * 1024 * 1024))

    await expect(connecting).rejects.toThrow('must be text JSON')
  })
})

describe('AdaptiveTransport capability negotiation', () => {
  it('moves Relay ciphertext to the assigned data socket while keeping handshake on control', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const transport = createAdaptiveTransport({ forceRelay: true })
    const connecting = transport.connect()
    const control = FakeWebSocket.latest!
    control.open()
    control.receive(helloAck({ capabilities: ['transport.relay', 'transport.relay.attach'] }))
    await Promise.resolve()
    control.receive(createControlFrame('connect.accepted', {
      connectionId: 'connection-1',
      relayEndpoint: 'wss://relay.example/ws',
      relayTicket: 'dshrt.payload.signature',
      relayNodeId: 'relay-1',
      relayEpoch: 4,
    }))
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2))
    const data = FakeWebSocket.instances[1]!
    data.open()
    expect(JSON.parse(data.sent[0]!)).toMatchObject({ type: 'relay.attach', payload: { connectionId: 'connection-1' } })
    data.receive({ v: 1, id: 'ready', type: 'relay.ready', timestamp: Date.now(), payload: { connectionId: 'connection-1', epoch: 4 } })
    await connecting
    await transport.sendHandshake(1, new Uint8Array([7]))
    await transport.send(new Uint8Array([8, 9]))
    expect(lastSentPayload(control, 'secure.handshake')).toMatchObject({ connectionId: 'connection-1' })
    expect(JSON.parse(data.sent[1]!)).toMatchObject({ type: 'relay', payload: { connectionId: 'connection-1', counter: 0 } })
    expect(lastSentPayload(control, 'transport.selected')).toMatchObject({ transport: 'relay' })
  })

  it('retains a confirmed independent Relay socket across control loss without resetting the relay counter', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    // Every recovery is now delayed: the restart window is drawn from
    // Math.random(), so drive it with fake timers instead of wall-clock waits.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    const transport = createAdaptiveTransport({ forceRelay: true, refreshAccessToken: async () => 'fresh-token' })
    const closed = vi.fn()
    transport.onClose(closed)
    try {
      const connecting = transport.connect()
      const control = FakeWebSocket.latest!
      control.open()
      control.receive(helloAck({ capabilities: ['transport.relay', 'transport.relay.attach', 'transport.relay.resume.v1'] }))
      control.receive(createControlFrame('connect.accepted', { connectionId: 'connection-1', relayEndpoint: 'wss://relay.example/ws', relayTicket: 'attach', relayEpoch: 4, relayRecoveryTicket: 'recovery' }))
      await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2))
      const data = FakeWebSocket.instances[1]!
      data.open()
      data.receive({ v: 1, id: 'ready', type: 'relay.ready', timestamp: Date.now(), payload: { connectionId: 'connection-1', epoch: 4 } })
      await connecting
      transport.markSecureReady()
      const lease = lastSentPayload(control, 'connection.lease.request')
      control.receive(createControlFrame('connection.lease.ack', { ...lease, ticket: 'renewed', leaseMs: 300_000 }))
      await transport.send(Uint8Array.of(1))
      control.readyState = 3
      control.onclose?.({ code: 1012, reason: 'restart' })
      await transport.send(Uint8Array.of(2))
      const relayFrames = data.sent.map(raw => JSON.parse(raw)).filter(frame => frame.type === 'relay')
      expect(relayFrames.map(frame => frame.payload.counter)).toEqual([0, 1])
      expect(transport.getStats().connected).toBe(true)
      expect(closed).not.toHaveBeenCalled()
      // The recovery timer is scheduled on a microtask after controlLost();
      // with Math.random() = 0 the delay is 0ms, so a single macrotask turn
      // fires it and the new control socket exists.
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(random).toHaveBeenCalled()
      expect(FakeWebSocket.instances).toHaveLength(3)
      const recovered = FakeWebSocket.latest!
      recovered.open()
      recovered.receive(helloAck({ capabilities: ['transport.relay', 'transport.relay.attach', 'transport.relay.resume.v1'] }))
      expect(lastSentPayload(recovered, 'connection.lease.request')).toMatchObject({ connectionId: 'connection-1', ticket: 'renewed' })
      data.readyState = 3
      data.onclose?.({ code: 1006, reason: '' })
      await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
    } finally { await transport.close() }
  })

  it('closes an established WebRTC data channel when the Control socket closes', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const rtc = stalledRtc()
    const disconnected = vi.fn()
    const closed = vi.fn()
    const transport = createAdaptiveTransport({ rtcFactory: rtc.factory, onDisconnect: disconnected })
    transport.onClose(closed)

    const connecting = transport.connect()
    const socket = FakeWebSocket.latest!
    socket.open()
    socket.receive(helloAck({ capabilities: ['transport.p2p', 'transport.relay'] }))
    socket.receive(createControlFrame('connect.accepted', { connectionId: 'connection-1' }))
    await vi.waitFor(() => expect(rtc.channel.onopen).toBeTypeOf('function'))
    rtc.channel.readyState = 'open'
    rtc.channel.onopen?.()
    await connecting
    expect(transport.getStats().connected).toBe(true)

    await transport.send(Uint8Array.of(1, 2, 3))
    expect(rtc.channel.send).toHaveBeenCalledOnce()
    socket.readyState = 3
    socket.onclose?.({ code: 1012, reason: 'Server restart' })

    await vi.waitFor(() => expect(rtc.channel.close).toHaveBeenCalledOnce())
    expect(rtc.pc.close).toHaveBeenCalledOnce()
    expect(transport.getStats().connected).toBe(false)
    expect(disconnected).toHaveBeenCalledWith({ reason: 'control-closed', closeCode: 1012, closeReason: 'Server restart' })
    expect(closed).toHaveBeenCalledOnce()
    await expect(transport.send(Uint8Array.of(4))).rejects.toThrow('not been authorized')
  })

  it('retains confirmed WebRTC data while reauthenticating control without creating a new logical connection', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const rtc = stalledRtc()
    const refresh = vi.fn(async () => 'fresh-access-token')
    const transport = createAdaptiveTransport({ rtcFactory: rtc.factory, refreshAccessToken: refresh })
    const closed = vi.fn()
    transport.onClose(closed)
    try {
      const connecting = transport.connect()
      const socket = FakeWebSocket.latest!
      socket.open()
      socket.receive(helloAck({ capabilities: ['transport.p2p', 'transport.webrtc.resume.v1'] }))
      socket.receive(createControlFrame('connect.accepted', { connectionId: 'connection-1', recoveryTicket: 'initial' }))
      await vi.waitFor(() => expect(rtc.channel.onopen).toBeTypeOf('function'))
      rtc.channel.readyState = 'open'
      rtc.channel.onopen?.()
      await connecting
      transport.markSecureReady()
      const request = lastSentPayload(socket, 'connection.lease.request')
      socket.receive(createControlFrame('connection.lease.ack', { ...request, ticket: 'renewed', leaseMs: 300_000 }))
      // Every recovery is scheduled with a full-jitter delay now; Math.random()
      // = 0 keeps it at 0ms so a single macrotask turn fires the retry.
      vi.spyOn(Math, 'random').mockReturnValue(0)
      socket.readyState = 3
      socket.onclose?.({ code: 1012, reason: 'restart' })
      await transport.connect() // Idempotent while only control is detached.
      await transport.send(Uint8Array.of(1))
      expect(closed).not.toHaveBeenCalled()
      expect(rtc.pc.close).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(FakeWebSocket.latest).not.toBe(socket))
      const recovered = FakeWebSocket.latest!
      // The old control heartbeat is stale, but the new socket is still
      // handshaking. A forced lease tick must not close it.
      const internals = transport as unknown as { lastControlReceivedAt: number; lease: { tick(force: boolean): void } }
      internals.lastControlReceivedAt = Date.now() - 80_000
      internals.lease.tick(true)
      expect(FakeWebSocket.latest).toBe(recovered)
      expect(recovered.readyState).toBe(0)
      recovered.open()
      expect(lastSentPayload(recovered, 'hello')).toMatchObject({ accessToken: 'fresh-access-token' })
      recovered.receive(helloAck({ capabilities: ['transport.p2p', 'transport.webrtc.resume.v1'] }))
      const renewal = lastSentPayload(recovered, 'connection.lease.request')
      expect(renewal).toMatchObject({ connectionId: 'connection-1', ticket: 'renewed' })
      expect(recovered.sent.map(raw => JSON.parse(raw).type)).not.toContain('connect.request')
      recovered.receive(createControlFrame('connection.lease.ack', { ...renewal, ticket: 'recovered', leaseMs: 300_000 }))
      // Old-socket callbacks must not close the retained session.
      socket.onclose?.({ code: 4003, reason: 'stale replacement' })
      await transport.send(Uint8Array.of(2))
      expect(rtc.channel.send).toHaveBeenCalledTimes(2)
      expect(closed).not.toHaveBeenCalled()
      recovered.receive(createControlFrame('error', { code: 'DEVICE_REVOKED', message: 'revoked', retryable: false }))
      await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
    } finally { await transport.close() }
  })

  it('retains the session across both shutdown close codes and jitters only the first retry', async () => {
    await runScenarios([
      { name: '4009/server shutdown', code: 4009, reason: 'server shutdown' },
      { name: '4001/server shutdown', code: 4001, reason: 'server shutdown' },
    ].map(row => ({ name: row.name, run: async () => {
      vi.stubGlobal('WebSocket', FakeWebSocket)
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
      const rtc = stalledRtc()
      const transport = createAdaptiveTransport({ rtcFactory: rtc.factory })
      const closed = vi.fn()
      transport.onClose(closed)
      try {
        const connecting = transport.connect()
        const socket = FakeWebSocket.latest!
        socket.open()
        socket.receive(helloAck({ capabilities: ['transport.p2p', 'transport.webrtc.resume.v1'] }))
        socket.receive(createControlFrame('connect.accepted', { connectionId: 'connection-1', recoveryTicket: 'initial' }))
        await vi.waitFor(() => expect(rtc.channel.onopen).toBeTypeOf('function'))
        rtc.channel.readyState = 'open'
        rtc.channel.onopen?.()
        await connecting
        transport.markSecureReady()
        const request = lastSentPayload(socket, 'connection.lease.request')
        socket.receive(createControlFrame('connection.lease.ack', { ...request, ticket: 'renewed', leaseMs: 300_000 }))
        const instancesBefore = FakeWebSocket.instances.length

        // Install fake timers just before the control close so every real
        // event loop turn above stays untouched.
        vi.useFakeTimers()
        socket.readyState = 3
        socket.onclose?.({ code: row.code, reason: row.reason })
        // The lease keeps the authenticated WebRTC session alive, and a Server
        // restart is spread over the full [0, 15s] window instead of stampeding.
        expect(closed).not.toHaveBeenCalled()
        expect(rtc.pc.close).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(5_000)
        expect(FakeWebSocket.instances).toHaveLength(instancesBefore)
        await vi.advanceTimersByTimeAsync(3_000)
        expect(FakeWebSocket.instances).toHaveLength(instancesBefore + 1)
        expect(closed).not.toHaveBeenCalled()
        expect(random).toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
        await transport.close()
      }
    } })), cleanupScenario1)
  })

  it('retries the self-hosted heartbeat close without retrying authorization or unknown application closes', async () => {
    await runScenarios([
      { code: 4001, reason: 'CONNECTION_FAILED', retryable: true },
      { code: 4001, reason: 'AUTH_INVALID', failure: 'AUTH_INVALID', retryable: false },
      { code: 4001, reason: 'TOKEN_EXPIRED', failure: 'TOKEN_EXPIRED', retryable: false },
      { code: 4001, reason: 'DEVICE_REVOKED', failure: 'DEVICE_REVOKED', retryable: false },
      { code: 4001, reason: '', retryable: false },
      { code: 4001, reason: 'CONNECTION_FAILED: unknown detail', retryable: false },
      { code: 4003, reason: 'CONNECTION_FAILED', retryable: false },
      { code: 1008, reason: 'CONNECTION_FAILED', retryable: false },
      // Close semantics are keyed on the reason: the hosted Server uses 4009
      // for heartbeat expiry and 4001 for hello/auth failures and shutdown.
      { code: 4009, reason: 'heartbeat timeout', retryable: true },
      { code: 4009, reason: 'server shutdown', retryable: true },
      { code: 4001, reason: 'server shutdown', retryable: true },
      { code: 1013, reason: 'server shutdown', retryable: true },
      { code: 4009, reason: '', retryable: false },
    ].map(row => ({ name: `${row.code}/${row.reason}`, run: async () => {
      vi.stubGlobal('WebSocket', FakeWebSocket)
      const transport = createAdaptiveTransport({ forceRelay: true })
      const closed = vi.fn()
      transport.onClose(closed)
      const connecting = transport.connect()
      const socket = FakeWebSocket.latest!
      socket.open()
      socket.receive(helloAck({ capabilities: ['transport.relay'] }))
      socket.receive(createControlFrame('connect.accepted', { connectionId: 'connection-1' }))
      await connecting
      socket.onclose?.(row)
      expect(closed).toHaveBeenCalledOnce()
      expect(closed).toHaveBeenCalledWith(expect.objectContaining({
        code: row.failure ?? (row.code === 4003 ? 'CONNECTION_REPLACED' : 'TRANSPORT_CLOSED'), retryable: row.retryable,
      }))
      await transport.close()
    } })), cleanupScenario1)
  })

  it('reports established carrier failures without leaking control payloads or retrying old closes', async () => {
    await runScenarios(['control-closed', 'control-error', 'retryable-control-error', 'invalid-control-frame', 'webrtc-closed', 'local-close'].map(reason => ({
      name: reason, run: async () => {
        vi.stubGlobal('WebSocket', FakeWebSocket)
        const diagnostic = vi.fn()
        const closed = vi.fn()
        const rtc = reason === 'webrtc-closed' ? stalledRtc() : undefined
        const transport = createAdaptiveTransport({ onDisconnect: diagnostic, ...(rtc === undefined ? {} : { rtcFactory: rtc.factory }) })
        transport.onClose(closed)
        const connecting = transport.connect()
        const socket = FakeWebSocket.latest!
        socket.open()
        socket.receive(helloAck({ capabilities: rtc === undefined ? ['transport.relay'] : ['transport.p2p', 'transport.relay'] }))
        socket.receive(createControlFrame('connect.accepted', { connectionId: 'connection-1' }))
        if (rtc !== undefined) {
          await vi.waitFor(() => expect(rtc.channel.onopen).toBeTypeOf('function'))
          rtc.channel.readyState = 'open'
          rtc.channel.onopen?.()
        }
        await connecting
        if (reason === 'control-closed') socket.onclose?.({ code: 4003, reason: 'private upstream detail' })
        if (reason === 'control-error') socket.onerror?.()
        if (reason === 'retryable-control-error') {
          socket.receive(createControlFrame('error', { code: 'CONNECTION_FAILED', message: 'CONNECTION_FAILED', connectionId: 'connection-1', retryable: true }))
        }
        if (reason === 'invalid-control-frame') socket.receiveRaw('invalid private content')
        if (rtc !== undefined) (rtc.channel as unknown as { onclose: () => void }).onclose()
        if (reason === 'local-close') await transport.close()
        expect(closed).toHaveBeenCalledOnce()
        if (reason === 'control-closed') expect(closed).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONNECTION_REPLACED', retryable: false }))
        expect(transport.getStats().connected).toBe(false)
        if (reason === 'local-close') expect(diagnostic).not.toHaveBeenCalled()
        else expect(diagnostic.mock.calls).toEqual([[{
          reason: reason === 'retryable-control-error' ? 'control-error' : reason,
          ...(reason === 'control-closed' ? { closeCode: 4003, closeReason: 'private upstream detail' } : {}),
          ...(reason === 'webrtc-closed' ? { transport: 'p2p' } : {}),
          ...(reason === 'retryable-control-error' ? { errorCode: 'CONNECTION_FAILED' } : {}),
          ...(reason === 'invalid-control-frame' ? { errorCode: 'INVALID_MESSAGE' } : {}),
        }]])
        socket.onclose?.({ code: 1006, reason: '' })
        expect(closed).toHaveBeenCalledOnce()
      },
    })), cleanupScenario1)
  })
  it('separates authorization from RTC timeout while clamping Server budgets', async () => {
    await runScenarios([
      { name: 'old Server without timeout', server: undefined, local: undefined, budget: 8000 },
      { name: 'Server twenty seconds clamped to the mobile ceiling', server: 20000, local: undefined, budget: 12000 },
      { name: 'local budget wins over larger Server budget', server: 20000, local: 12000, budget: 12000 },
      { name: 'local budget exceeds Server budget', server: 8000, local: 12000, budget: 12000 },
    ].map(row => ({ name: row.name, run: async () => {
      vi.useFakeTimers()
      vi.stubGlobal('WebSocket', FakeWebSocket)
      const rtc = stalledRtc()
      const fallback = vi.fn()
      const transport = createAdaptiveTransport({
        rtcFactory: rtc.factory,
        negotiateTimeoutMs: row.local,
        fetchIceServers: async () => [{ urls: 'stun:stun.example.test' }],
        onWebRtcFallback: fallback,
      })
      let ready = false
      const connecting = transport.connect().then(() => { ready = true })
      const socket = FakeWebSocket.latest!
      socket.open()
      await vi.advanceTimersByTimeAsync(4000)
      socket.receive(helloAck({ capabilities: ['transport.p2p', 'transport.relay'], webrtcFallbackTimeoutMs: row.server }))
      socket.receive(createControlFrame('connect.accepted', { connectionId: 'connection-1' }))
      await vi.advanceTimersByTimeAsync(row.budget - 1)
      expect(ready).toBe(false)
      expect(socket.readyState).toBe(FakeWebSocket.OPEN)
      await vi.advanceTimersByTimeAsync(301)
      await connecting
      expect(fallback).toHaveBeenCalledOnce()
      expect(lastSentPayload(socket, 'transport.selected')).toMatchObject({ transport: 'relay' })
      expect(rtc.pc.close).toHaveBeenCalled()
      await transport.close()
      expect(vi.getTimerCount()).toBe(0)
    } })), cleanupScenario1)
  })

  it('bounds ICE discovery separately and ignores credentials arriving after cancellation or timeout', async () => {
    await runScenarios(['timeout', 'close', 'socket close', 'abort', 'reconnect'].map(action => ({ name: action, run: async () => {
      vi.useFakeTimers()
      vi.stubGlobal('WebSocket', FakeWebSocket)
      const rtc = stalledRtc()
      const abort = new AbortController()
      let deliver!: (servers: []) => void
      let requestSignal: AbortSignal | undefined
      const transport = createAdaptiveTransport({ rtcFactory: rtc.factory, signal: abort.signal,
        fetchIceServers: (_id, signal) => { requestSignal = signal; return new Promise(resolve => { deliver = resolve }) },
      })
      const outcome = transport.connect().then(() => 'ready', error => error.message as string)
      const socket = FakeWebSocket.latest!
      socket.open()
      socket.receive(helloAck({ capabilities: ['transport.p2p', 'transport.relay'], webrtcFallbackTimeoutMs: 20000 }))
      socket.receive(createControlFrame('connect.accepted', { connectionId: 'connection-1' }))
      await vi.advanceTimersByTimeAsync(0)
      if (action === 'timeout') {
        await vi.advanceTimersByTimeAsync(10000)
        expect(requestSignal?.aborted).toBe(true)
        await vi.advanceTimersByTimeAsync(20300)
        expect(await outcome).toBe('ready')
      } else {
        if (action === 'close' || action === 'reconnect') await transport.close()
        else if (action === 'abort') abort.abort()
        else socket.onclose?.({ code: 1006, reason: '' })
        expect(await outcome).not.toBe('ready')
        expect(requestSignal?.aborted).toBe(true)
        expect(rtc.factory.create).not.toHaveBeenCalled()
      }
      if (action === 'reconnect') {
        const reconnecting = transport.connect()
        const replacement = FakeWebSocket.latest!
        replacement.open()
        replacement.receive(helloAck({ capabilities: ['transport.relay'] }))
        replacement.receive(createControlFrame('connect.accepted', { connectionId: 'connection-2' }))
        await reconnecting
        socket.onclose?.({ code: 1006, reason: 'late close' })
        expect(transport.connectionInfo().connectionId).toBe('connection-2')
        expect(transport.getStats().connected).toBe(true)
      }
      const sent = socket.sent.length
      deliver([])
      await vi.advanceTimersByTimeAsync(0)
      expect(socket.sent).toHaveLength(sent)
      await transport.close()
      expect(vi.getTimerCount()).toBe(0)
    } })), cleanupScenario1)
  })

  it('settles control and RTC cancellation without allowing stale attempts to select a transport', async () => {
    await runScenarios(['control timeout', 'control close', 'rtc close', 'rtc abort', 'late RTC success', 'statistics timeout'].map(action => ({ name: action, run: async () => {
      vi.useFakeTimers()
      vi.stubGlobal('WebSocket', FakeWebSocket)
      const rtc = stalledRtc()
      const abort = new AbortController()
      const transport = createAdaptiveTransport({
        rtcFactory: rtc.factory,
        signal: abort.signal,
        // Keep a wide negotiation window: these scenarios cancel in the
        // middle of pending RTC, which must stay pending until acted on.
        negotiateTimeoutMs: 20_000,
        fetchIceServers: async () => [{ urls: 'stun:stun.example.test' }],
      })
      const outcome = transport.connect().then(() => 'ready', error => error.message as string)
      const socket = FakeWebSocket.latest!
      socket.open()
      socket.receive(helloAck({ capabilities: ['transport.p2p', 'transport.relay'], webrtcFallbackTimeoutMs: 20000 }))
      if (!action.startsWith('control')) {
        socket.receive(createControlFrame('connect.accepted', { connectionId: 'connection-1' }))
        await vi.advanceTimersByTimeAsync(16000)
      }
      if (action === 'late RTC success' || action === 'statistics timeout') {
        if (action === 'statistics timeout') vi.spyOn(rtc.pc, 'getStats').mockImplementation(() => new Promise(() => {}))
        rtc.channel.readyState = 'open'
        rtc.channel.onopen?.()
        await vi.advanceTimersByTimeAsync(300)
        expect(await outcome).toBe('ready')
        expect(lastSentPayload(socket, 'transport.selected')).toMatchObject({ transport: 'p2p' })
      } else {
        if (action === 'control timeout') await vi.advanceTimersByTimeAsync(15000)
        else if (action === 'rtc abort') abort.abort()
        else await transport.close()
        expect(await outcome).not.toBe('ready')
        rtc.channel.onopen?.()
        await vi.advanceTimersByTimeAsync(30000)
        expect(socket.sent.some(frame => JSON.parse(frame).type === 'transport.selected')).toBe(false)
      }
      await transport.close()
      expect(vi.getTimerCount()).toBe(0)
    } })), cleanupScenario1)
  })

  it('records heartbeat diagnostics and replies to ping', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-29T01:00:00.000Z'))
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const transport = createAdaptiveTransport()
    const connecting = transport.connect()
    const socket = FakeWebSocket.latest!
    socket.open()
    socket.receive(helloAck({ capabilities: ['transport.relay'] }))
    await Promise.resolve()
    socket.receive(createControlFrame('connect.accepted', { connectionId: 'connection-1' }))
    await connecting

    vi.setSystemTime(new Date('2026-09-29T01:00:05.000Z'))
    socket.receive(createControlFrame('ping', { nonce: 'heartbeat-1' }))

    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
      type: 'pong',
      payload: { nonce: 'heartbeat-1' },
    })
    await expect(transport.connectionDetails()).resolves.toMatchObject({
      heartbeatIntervalMs: 25_000,
      lastControlReceivedAt: Date.parse('2026-09-29T01:00:05.000Z'),
      lastControlSentAt: Date.parse('2026-09-29T01:00:05.000Z'),
    })
  })

  it('updates receive activity for an ordinary control frame', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-29T02:00:00.000Z'))
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const transport = createAdaptiveTransport()
    const connecting = transport.connect()
    const socket = FakeWebSocket.latest!
    socket.open()
    socket.receive(helloAck({ capabilities: ['transport.relay'] }))
    await Promise.resolve()
    socket.receive(createControlFrame('connect.accepted', { connectionId: 'connection-1' }))
    await connecting
    const before = await transport.connectionDetails()

    vi.setSystemTime(new Date('2026-09-29T02:00:07.000Z'))
    socket.receive(createControlFrame('transport.selected', {
      connectionId: 'connection-1',
      targetDeviceId: 'client-1',
      transport: 'relay',
    }))

    await expect(transport.connectionDetails()).resolves.toMatchObject({
      lastControlReceivedAt: Date.parse('2026-09-29T02:00:07.000Z'),
      lastControlSentAt: before.lastControlSentAt,
    })
  })

  it('constrains TURN-only ICE, preserves automatic ICE, and keeps Relay fallback', async () => {
    await runScenarios([
      { name: 'TURN-only', preferred: ['turn', 'relay'] as const, policy: 'relay' },
      { name: 'automatic', preferred: ['lan', 'p2p', 'turn', 'relay'] as const, policy: 'all' },
    ].map(row => ({ name: row.name, run: async () => {
      vi.useFakeTimers()
      vi.stubGlobal('WebSocket', FakeWebSocket)
      const rtc = stalledRtc()
      const transport = createAdaptiveTransport({
        rtcFactory: rtc.factory,
        preferredTransports: [...row.preferred],
        negotiateTimeoutMs: 1000,
        fetchIceServers: async () => [{ urls: 'turn:turn.example.test', username: 'user', credential: 'secret' }],
      })
      const connecting = transport.connect()
      const socket = FakeWebSocket.latest!
      socket.open()
      socket.receive(helloAck({ capabilities: ['transport.p2p', 'transport.turn', 'transport.relay'] }))
      socket.receive(createControlFrame('connect.accepted', { connectionId: 'connection-1' }))
      await vi.advanceTimersByTimeAsync(1)
      expect(rtc.factory.create).toHaveBeenCalledWith(expect.objectContaining({ iceTransportPolicy: row.policy }))
      expect(lastSentPayload(socket, 'connect.request')).toMatchObject({
        preferredTransports: row.preferred.filter(value => value !== 'lan'),
      })
      await vi.advanceTimersByTimeAsync(1300)
      await connecting
      expect(lastSentPayload(socket, 'transport.selected')).toMatchObject({ transport: 'relay' })
      await transport.close()
    } })), cleanupScenario1)
  })

  it('requests only transports present in hello.ack capabilities', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const transport = new AdaptiveTransport('wss://remote.example/ws/v1/connect', {
      role: 'client',
      deviceId: 'client-1',
      accessToken: 'access-token',
      targetDeviceId: 'host-1',
    })
    const connecting = transport.connect()
    const socket = FakeWebSocket.latest!
    socket.open()
    socket.receive(createControlFrame('hello.ack', {
      protocol: 1,
      serverVersion: '0.1.0',
      connectionSessionId: 'control-1',
      heartbeatIntervalMs: 25_000,
      maxControlFrameBytes: 65_536,
      maxRelayFrameBytes: 1_048_576,
      capabilities: ['transport.relay'],
    }))
    await Promise.resolve()
    expect(JSON.parse(socket.sent[1]!)).toMatchObject({
      type: 'connect.request',
      payload: { preferredTransports: ['relay'] },
    })
    socket.receive(createControlFrame('connect.accepted', { connectionId: 'connection-1' }))
    await connecting
  })

  it('rejects selected transports outside negotiated capabilities', async () => {
    const rows = [
      {
        name: 'preserves LAN when LAN was negotiated',
        capabilities: ['transport.lan', 'transport.p2p'],
        selected: 'lan' as const,
        expected: 'lan',
      },
      {
        name: 'downgrades LAN for an older P2P-only server',
        capabilities: ['transport.p2p'],
        selected: 'lan' as const,
        expected: 'p2p',
      },
      {
        name: 'falls back when TURN-only negotiation selects P2P',
        capabilities: ['transport.turn', 'transport.relay'],
        selected: 'p2p' as const,
        expected: 'relay',
      },
      {
        name: 'rejects when P2P-only negotiation selects TURN',
        capabilities: ['transport.p2p'],
        selected: 'turn' as const,
        expected: 'reject',
      },
    ] as const
    await runScenarios(
      rows.map((row, index) => {
        const { capabilities, selected, expected } = row
        return {
          name: scenarioName('$name', row, index),
          run: async () => {
            vi.stubGlobal('WebSocket', FakeWebSocket)
            vi.spyOn(RtcDataChannelTransport.prototype, 'connect').mockResolvedValue()
            vi.spyOn(RtcDataChannelTransport.prototype, 'selectedTransport').mockReturnValue(selected)
            vi.spyOn(RtcDataChannelTransport.prototype, 'diagnostics').mockReturnValue({} as never)
            vi.spyOn(RtcDataChannelTransport.prototype, 'close').mockResolvedValue()
            const transport = createAdaptiveTransport()
            const connecting = transport.connect()
            const socket = FakeWebSocket.latest!
            socket.open()
            socket.receive(helloAck({ capabilities }))
            await Promise.resolve()
            socket.receive(createControlFrame('connect.accepted', { connectionId: 'connection-1' }))
            if (expected === 'reject') {
              await expect(connecting).rejects.toThrow(`WebRTC selected unnegotiated transport: ${selected}`)
            } else {
              await connecting
              expect(lastSentPayload(socket, 'transport.selected')).toMatchObject({ transport: expected })
            }
          },
        }
      }),
      async () => {
        await cleanupScenario1()
      },
    )
  })

  it('rejects P2P-only negotiation when WebRTC is disabled', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const transport = createAdaptiveTransport()
    const connecting = transport.connect()
    const socket = FakeWebSocket.latest!
    socket.open()
    socket.receive(helloAck({ capabilities: ['transport.p2p'], webrtcEnabled: false }))
    await Promise.resolve()
    socket.receive(createControlFrame('connect.accepted', { connectionId: 'connection-1' }))
    await expect(connecting).rejects.toThrow('No negotiated transport is available')
  })

  it('enforces the negotiated Control limit on incoming frames', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const transport = createAdaptiveTransport()
    const connecting = transport.connect()
    const socket = FakeWebSocket.latest!
    socket.open()
    socket.receive(helloAck({
      capabilities: ['transport.relay'],
      maxControlFrameBytes: 256,
    }))
    await Promise.resolve()
    socket.receive(createControlFrame('connect.accepted', {
      connectionId: 'x'.repeat(300),
    }))

    await expect(connecting).rejects.toThrow('Control frame exceeds')
  })
})

function createAdaptiveTransport(options: Partial<AdaptiveTransportOptions> = {}): AdaptiveTransport {
  return new AdaptiveTransport('wss://remote.example/ws/v1/connect', {
    role: 'client',
    deviceId: 'client-1',
    accessToken: 'access-token',
    targetDeviceId: 'host-1',
    rtcFactory: { create: vi.fn(() => ({})) } as unknown as RtcPeerConnectionFactory,
    ...options,
  })
}

function helloAck(overrides: {
  capabilities: string[]
  webrtcEnabled?: boolean
  webrtcFallbackTimeoutMs?: number
  maxControlFrameBytes?: number
  maxRelayFrameBytes?: number
}): unknown {
  return createControlFrame('hello.ack', {
    protocol: 1,
    serverVersion: '0.1.0',
    connectionSessionId: 'control-1',
    heartbeatIntervalMs: 25_000,
    maxControlFrameBytes: 65_536,
    maxRelayFrameBytes: 1_048_576,
    ...overrides,
  })
}

function stalledRtc() {
  const channel = { label: 'dsh', ordered: true, readyState: 'connecting', bufferedAmount: 0,
    onopen: null as (() => void) | null, close: vi.fn(), send: vi.fn() }
  const pc = {
    connectionState: 'new', iceConnectionState: 'new', iceGatheringState: 'new',
    createDataChannel: () => channel,
    createOffer: async () => ({ type: 'offer', sdp: 'v=0 offer' }),
    setLocalDescription: async () => {},
    getStats: async () => [
      ['lc', { id: 'lc', type: 'local-candidate', candidateType: 'host' }],
      ['rc', { id: 'rc', type: 'remote-candidate', candidateType: 'srflx' }],
      ['cp', { type: 'candidate-pair', selected: true, localCandidateId: 'lc', remoteCandidateId: 'rc' }],
    ],
    close: vi.fn(),
  }
  return { pc, channel, factory: { create: vi.fn(() => pc) } as unknown as RtcPeerConnectionFactory }
}

function lastSentPayload(socket: FakeWebSocket, type: string): Record<string, unknown> {
  const frame = socket.sent
    .map(value => JSON.parse(value) as { type?: string; payload?: Record<string, unknown> })
    .findLast(value => value.type === type)
  if (frame?.payload === undefined) throw new Error(`Missing ${type} frame`)
  return frame.payload
}
