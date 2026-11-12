import { waitForRelayCapacity } from './websocket-backpressure.js'
import {
  PROTOCOL_VERSION,
  acceptNegotiatedCapabilities,
  createControlFrame,
  createRelayDataFrame,
  decodeControlFrame,
  decodeRelayDataFrame,
  encodeControlFrame,
  encodeRelayDataFrame,
  type ControlFrameByteLimits,
  type ConnectAcceptedPayload,
  type HelloAckPayload,
  type RelayPayload,
  type SecureHandshakePayload,
  type TransportStats,
} from '@dsh-remote/protocol'
import { BaseTransport } from './transport.js'
import { fromBase64Url, toBase64Url } from './util.js'

export * from './transport.js'
export * from './rtc-adapter.js'
export * from './rtc-chunking.js'
export * from './rtc-data-channel.js'
export * from './adaptive-transport.js'

export interface RelayTransportOptions {
  role: 'client'
  deviceId: string
  accessToken: string
  targetDeviceId: string
  capabilities?: string[]
  preferredTransports?: Array<'lan' | 'p2p' | 'turn' | 'relay'>
  handshakeTimeoutMs?: number
  /** See AdaptiveTransportOptions.createWebSocket. */
  createWebSocket?: (url: string) => WebSocket
}

type RelayAssignment = Pick<ConnectAcceptedPayload, 'relayEndpoint' | 'relayTicket' | 'relayNodeId' | 'relayEpoch'>

export class RelayTransport extends BaseTransport {
  private readonly handshakeHandlers = new Set<(step: number, data: Uint8Array) => void>()
  private socket?: WebSocket
  private dataSocket?: WebSocket
  private bytesSent = 0
  private bytesReceived = 0
  private connectionId?: string
  private relayCounter = 0
  private readyResolve?: () => void
  private readyReject?: (error: Error) => void
  private handshakeTimer?: ReturnType<typeof setTimeout>
  private controlFrameLimits: ControlFrameByteLimits = {}
  private dataReadyResolve?: () => void
  private dataReadyReject?: (error: Error) => void
  private dataReady = false

  constructor(
    private readonly url: string,
    private readonly options: RelayTransportOptions,
  ) {
    super()
  }

  private openSocket(url: string): WebSocket {
    return (this.options.createWebSocket ?? ((endpoint: string) => new WebSocket(endpoint)))(url)
  }

  async connect(): Promise<void> {
    if (this.socket !== undefined) return
    this.socket = this.openSocket(this.url)
    this.controlFrameLimits = {}
    this.socket.binaryType = 'arraybuffer'
    await new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
      this.handshakeTimer = setTimeout(
        () => this.failConnection(new Error('Relay control handshake timed out')),
        this.options.handshakeTimeoutMs ?? 10_000,
      )
      const socket = this.socket!
      socket.onmessage = event => {
        void this.handleSocketMessage(event.data)
      }
      socket.onopen = () => {
        this.sendControl('hello', {
          role: this.options.role,
          deviceId: this.options.deviceId,
          accessToken: this.options.accessToken,
          protocols: [PROTOCOL_VERSION],
          capabilities: this.options.capabilities ?? ['transport.relay', 'transport.relay.attach'],
        })
      }
      socket.onerror = () => this.failConnection(new Error(`RelayTransport failed to connect to ${this.url}`))
      socket.onclose = () => {
        const pending = this.readyReject !== undefined
        if (pending) this.failConnection(new Error('Relay control channel closed before it was ready'))
        this.socket = undefined
        this.connectionId = undefined
        this.emitClose()
      }
    })
  }

  async send(data: Uint8Array): Promise<void> {
    const socket = this.dataSocket ?? this.socket
    if (socket?.readyState !== WebSocket.OPEN) throw new Error('relay transport is not connected')
    if (this.connectionId === undefined) throw new Error('relay connection has not been authorized')
    await waitForRelayCapacity(socket)
    const payload = {
      connectionId: this.connectionId,
      targetDeviceId: this.options.targetDeviceId,
      counter: this.relayCounter,
      ciphertext: toBase64Url(data),
    } satisfies RelayPayload
    if (this.dataSocket !== undefined) {
      this.dataSocket.send(encodeRelayDataFrame(createRelayDataFrame('relay', payload), this.controlFrameLimits))
    }
    else this.sendControl('relay', payload)
    this.bytesSent += data.byteLength
    this.relayCounter += 1
  }

  connectionInfo(): { connectionId: string; localDeviceId: string; remoteDeviceId: string } {
    if (this.connectionId === undefined) throw new Error('relay connection has not been authorized')
    return {
      connectionId: this.connectionId,
      localDeviceId: this.options.deviceId,
      remoteDeviceId: this.options.targetDeviceId,
    }
  }

  async sendHandshake(step: number, data: Uint8Array): Promise<void> {
    if (this.socket?.readyState !== WebSocket.OPEN || this.connectionId === undefined) {
      throw new Error('relay connection has not been authorized')
    }
    this.sendControl('secure.handshake', {
      connectionId: this.connectionId,
      targetDeviceId: this.options.targetDeviceId,
      step,
      data: toBase64Url(data),
    } satisfies SecureHandshakePayload)
  }

  onHandshake(cb: (step: number, data: Uint8Array) => void): () => void {
    this.handshakeHandlers.add(cb)
    return () => this.handshakeHandlers.delete(cb)
  }

  async close(): Promise<void> {
    this.clearHandshake()
    this.dataSocket?.close()
    this.dataSocket = undefined
    this.dataReady = false
    this.socket?.close()
    this.socket = undefined
    this.connectionId = undefined
  }

  getStats(): TransportStats {
    return {
      mode: this.socket?.readyState === WebSocket.OPEN ? 'Relay' : 'Disconnected',
      connected: this.socket?.readyState === WebSocket.OPEN,
      bytesSent: this.bytesSent,
      bytesReceived: this.bytesReceived,
    }
  }

  private async handleSocketMessage(raw: string | ArrayBuffer | Blob): Promise<void> {
    try {
      if (typeof raw !== 'string') throw new Error('Relay control frames must be text JSON')
      const frame = decodeControlFrame(raw, this.controlFrameLimits)
      if (frame.type === 'hello.ack') {
        const payload = frame.payload as Partial<HelloAckPayload>
        if (payload.protocol !== PROTOCOL_VERSION) throw new Error('Server selected an unsupported protocol version')
        const offered = this.options.capabilities ?? ['transport.relay', 'transport.relay.attach']
        const negotiated = acceptNegotiatedCapabilities(offered, payload.capabilities)
        this.controlFrameLimits = {
          maxControlFrameBytes: payload.maxControlFrameBytes,
          maxRelayFrameBytes: payload.maxRelayFrameBytes,
        }
        if (!negotiated.includes('transport.relay')) {
          throw new Error('Server did not negotiate the required Relay capability')
        }
        this.sendControl('connect.request', {
          hostDeviceId: this.options.targetDeviceId,
          preferredTransports: ['relay'],
        })
        return
      }
      if (frame.type === 'connect.accepted') {
        const payload = frame.payload as Partial<ConnectAcceptedPayload>
        if (typeof payload.connectionId !== 'string' || payload.connectionId.length === 0) {
          throw new Error('connect.accepted did not include a connectionId')
        }
        this.connectionId = payload.connectionId
        const assignment = payload as RelayAssignment
        if (typeof assignment.relayEndpoint === 'string' && typeof assignment.relayTicket === 'string') {
          await this.openDataSocket(assignment)
        }
        this.finishConnection()
        return
      }
      if (frame.type === 'connect.rejected' || frame.type === 'error') {
        const payload = frame.payload as { message?: unknown; code?: unknown }
        const message = typeof payload.message === 'string' ? payload.message : 'Server rejected the relay connection'
        throw Object.assign(new Error(message), { code: payload.code })
      }
      if (frame.type === 'relay') {
        if (this.dataSocket !== undefined) return
        const payload = frame.payload as Partial<RelayPayload>
        if (payload.connectionId !== this.connectionId
          || payload.targetDeviceId !== this.options.deviceId
          || !Number.isSafeInteger(payload.counter)
          || typeof payload.ciphertext !== 'string') {
          throw new Error('Received a relay frame for an unknown connection')
        }
        const data = fromBase64Url(payload.ciphertext)
        this.bytesReceived += data.byteLength
        this.emit(data)
        return
      }
      if (frame.type === 'secure.handshake') {
        const payload = frame.payload as Partial<SecureHandshakePayload>
        if (payload.connectionId !== this.connectionId
          || payload.targetDeviceId !== this.options.deviceId
          || !Number.isSafeInteger(payload.step)
          || typeof payload.data !== 'string') {
          throw new Error('Received a secure handshake frame for an unknown connection')
        }
        const data = fromBase64Url(payload.data)
        for (const handler of this.handshakeHandlers) handler(payload.step!, data)
        return
      }
      if (frame.type === 'ping') this.sendControl('pong', frame.payload)
    } catch (error) {
      this.failConnection(error instanceof Error ? error : new Error('Invalid relay control frame'))
    }
  }

  private sendControl(type: Parameters<typeof createControlFrame>[0], payload: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('relay control socket is not open')
    this.socket.send(encodeControlFrame(createControlFrame(type, payload), this.controlFrameLimits))
  }

  private async openDataSocket(assignment: RelayAssignment): Promise<void> {
    if (this.connectionId === undefined || this.dataSocket !== undefined) return
    const socket = this.openSocket(assignment.relayEndpoint!)
    socket.binaryType = 'arraybuffer'
    this.dataSocket = socket
    await new Promise<void>((resolve, reject) => {
      this.dataReadyResolve = resolve
      this.dataReadyReject = reject
      const timer = setTimeout(() => {
        this.dataReadyResolve = undefined
        this.dataReadyReject = undefined
        reject(new Error('Relay data attach timed out'))
        socket.close()
      }, this.options.handshakeTimeoutMs ?? 10_000)
      socket.onopen = () => {
        socket.send(encodeRelayDataFrame(createRelayDataFrame('relay.attach', {
          connectionId: this.connectionId,
          deviceId: this.options.deviceId,
          peerDeviceId: this.options.targetDeviceId,
          ticket: assignment.relayTicket,
        }), this.controlFrameLimits))
      }
      socket.onmessage = event => {
        try {
          if (typeof event.data !== 'string') throw new Error('Relay data frames must be text JSON')
          const data = decodeRelayDataFrame(event.data, this.controlFrameLimits)
          if (data.type === 'relay.ready') {
            if (data.payload.connectionId !== this.connectionId
              || (assignment.relayEpoch !== undefined && data.payload.epoch !== assignment.relayEpoch)) {
              throw new Error('Relay data attach assignment mismatch')
            }
            clearTimeout(timer)
            this.dataReady = true
            this.dataReadyResolve = undefined
            this.dataReadyReject = undefined
            resolve()
            return
          }
          void this.handleDataSocketFrame(data.type, data.payload).catch(error => {
            this.failConnection(error instanceof Error ? error : new Error('Invalid Relay data frame'))
          })
        } catch (error) {
          clearTimeout(timer)
          reject(error instanceof Error ? error : new Error('Invalid Relay data frame'))
          this.failConnection(error instanceof Error ? error : new Error('Invalid Relay data frame'))
        }
      }
      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error('Relay data socket failed'))
      }
      socket.onclose = () => {
        clearTimeout(timer)
        if (!this.dataReady) reject(new Error('Relay data socket closed before attach'))
        else this.failConnection(new Error('Relay data socket closed'))
      }
    })
  }

  private async handleDataSocketFrame(type: string, payload: Record<string, unknown>): Promise<void> {
    if (type === 'relay.detach') {
      this.failConnection(new Error('Relay peer detached'))
      return
    }
    if (type === 'ping') {
      if (this.dataSocket?.readyState === WebSocket.OPEN) {
        this.dataSocket.send(encodeRelayDataFrame(createRelayDataFrame('pong', payload), this.controlFrameLimits))
      }
      return
    }
    if (type === 'relay') {
      if (payload.connectionId !== this.connectionId || payload.targetDeviceId !== this.options.deviceId
        || !Number.isSafeInteger(payload.counter) || typeof payload.ciphertext !== 'string') {
        throw new Error('Received a relay frame for an unknown connection')
      }
      const data = fromBase64Url(payload.ciphertext)
      this.bytesReceived += data.byteLength
      this.emit(data)
      return
    }
    if (type === 'secure.handshake') {
      if (payload.connectionId !== this.connectionId || payload.targetDeviceId !== this.options.deviceId
        || !Number.isSafeInteger(payload.step) || typeof payload.data !== 'string') {
        throw new Error('Received a secure handshake frame for an unknown connection')
      }
      const data = fromBase64Url(payload.data)
      for (const handler of this.handshakeHandlers) handler(payload.step as number, data)
    }
  }

  private finishConnection(): void {
    this.clearHandshake()
    this.readyResolve?.()
    this.readyResolve = undefined
    this.readyReject = undefined
  }

  private failConnection(error: Error): void {
    this.clearHandshake()
    const reject = this.readyReject
    this.readyResolve = undefined
    this.readyReject = undefined
    reject?.(error)
    const dataSocket = this.dataSocket
    this.dataSocket = undefined
    this.dataReady = false
    this.dataReadyResolve = undefined
    this.dataReadyReject = undefined
    dataSocket?.close()
    this.socket?.close()
    this.socket = undefined
    this.connectionId = undefined
  }

  private clearHandshake(): void {
    if (this.handshakeTimer !== undefined) clearTimeout(this.handshakeTimer)
    this.handshakeTimer = undefined
  }
}

export { waitForRelayCapacity } from './websocket-backpressure.js'

export { SerialSend } from './serial-send.js'

export * from './control-lease.js'
