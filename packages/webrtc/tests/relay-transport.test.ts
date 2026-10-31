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
    expect(disconnected).toHaveBeenCalledWith({ reason: 'control-closed', closeCode: 1012 })
    expect(closed).toHaveBeenCalledOnce()
    await expect(transport.send(Uint8Array.of(4))).rejects.toThrow('not been authorized')
  })

  it('retries the self-hosted heartbeat close without retrying authorization or unknown application closes', async () => {
    await runScenarios([
      { code: 4001, reason: 'CONNECTION_FAILED', retryable: true },
      { code: 4001, reason: 'AUTH_INVALID', retryable: false },
      { code: 4001, reason: 'DEVICE_REVOKED', retryable: false },
      { code: 4001, reason: '', retryable: false },
      { code: 4001, reason: 'CONNECTION_FAILED: unknown detail', retryable: false },
      { code: 4003, reason: 'CONNECTION_FAILED', retryable: false },
      { code: 1008, reason: 'CONNECTION_FAILED', retryable: false },
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
        code: row.code === 4003 ? 'CONNECTION_REPLACED' : 'TRANSPORT_CLOSED', retryable: row.retryable,
      }))
      await transport.close()
    } })), cleanupScenario1)
  })

  it('reports established carrier failures without leaking control payloads or retrying old closes', async () => {
    await runScenarios(['control-closed', 'control-error', 'invalid-control-frame', 'webrtc-closed', 'local-close'].map(reason => ({
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
        if (reason === 'invalid-control-frame') socket.receiveRaw('invalid private content')
        if (rtc !== undefined) (rtc.channel as unknown as { onclose: () => void }).onclose()
        if (reason === 'local-close') await transport.close()
        expect(closed).toHaveBeenCalledOnce()
        if (reason === 'control-closed') expect(closed).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONNECTION_REPLACED', retryable: false }))
        expect(transport.getStats().connected).toBe(false)
        if (reason === 'local-close') expect(diagnostic).not.toHaveBeenCalled()
        else expect(diagnostic.mock.calls).toEqual([[{
          reason, ...(reason === 'control-closed' ? { closeCode: 4003 } : {}),
        }]])
        socket.onclose?.({ code: 1006, reason: '' })
        expect(closed).toHaveBeenCalledOnce()
      },
    })), cleanupScenario1)
  })
  it('separates authorization from RTC timeout while preserving old and new Server budgets', async () => {
    await runScenarios([
      { name: 'old Server without timeout', server: undefined, local: undefined, budget: 8000 },
      { name: 'Server requests twenty seconds', server: 20000, local: undefined, budget: 20000 },
      { name: 'Server budget exceeds local direct budget', server: 20000, local: 12000, budget: 20000 },
      { name: 'local budget exceeds Server budget', server: 8000, local: 12000, budget: 12000 },
    ].map(row => ({ name: row.name, run: async () => {
      vi.useFakeTimers()
      vi.stubGlobal('WebSocket', FakeWebSocket)
      const rtc = stalledRtc()
      const fallback = vi.fn()
      const transport = createAdaptiveTransport({ rtcFactory: rtc.factory, negotiateTimeoutMs: row.local, onWebRtcFallback: fallback })
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
      const transport = createAdaptiveTransport({ rtcFactory: rtc.factory, signal: abort.signal })
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
