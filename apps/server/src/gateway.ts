import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { createControlFrame, decodeControlFrame, MAX_CONTROL_FRAME_BYTES, MAX_RELAY_FRAME_BYTES, type ControlFrame, type HelloPayload, type ConnectRequestPayload, type SecureHandshakePayload, type RelayPayload, type TransportSelectedPayload } from '@dsh-remote/protocol'
import { ApiError, Store } from './store.js'

type Peer = { ws: WebSocket; id: string; role: 'host' | 'client'; capabilities: string[]; version: string; lastPong: number; nonce?: string }
type Link = { id: string; host: string; client: string; stage: 'pending' | 'accepted' | 'handshake' | 'ready'; created: number; counters: Map<string, number> }
function modernHost(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:\+.*)?$/.exec(version)
  if (!match) return false
  const [major, minor, patch] = match.slice(1).map(Number)
  return major! > 0 || (minor! > 2 || (minor === 2 && patch! >= 15))
}

export class Gateway {
  readonly peers = new Map<string, Peer>()
  private links = new Map<string, Link>()
  private wss = new WebSocketServer({ noServer: true, maxPayload: MAX_RELAY_FRAME_BYTES, perMessageDeflate: false })
  private heartbeat: ReturnType<typeof setInterval>
  constructor(server: Server, private store: Store, origin: string) {
    store.onInvalidate = id => this.disconnect(id, 'AUTH_INVALID')
    server.on('upgrade', (req, socket, head) => {
      if (req.url !== '/ws/v1/connect' || (req.headers.origin && req.headers.origin !== origin) || this.wss.clients.size >= 256) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return
      }
      this.wss.handleUpgrade(req, socket, head, ws => this.accept(ws))
    })
    this.heartbeat = setInterval(() => {
      for (const peer of this.peers.values()) {
        if (Date.now() - peer.lastPong > 75_000) { this.disconnect(peer.id, 'CONNECTION_FAILED'); continue }
        peer.nonce = randomUUID()
        this.send(peer, createControlFrame('ping', { nonce: peer.nonce }))
      }
      for (const link of this.links.values()) if (link.stage !== 'ready' && Date.now() - link.created > 30_000) this.drop(link, 'CONNECTION_FAILED')
    }, 25_000)
    this.heartbeat.unref()
  }
  private send(peer: Peer, frame: ControlFrame): void {
    if (peer.ws.readyState !== WebSocket.OPEN) return
    if (peer.ws.bufferedAmount > 4 * MAX_RELAY_FRAME_BYTES) { this.disconnect(peer.id, 'SLOW_CONSUMER'); return }
    peer.ws.send(JSON.stringify(frame))
  }
  private drop(link: Link, code: string): void {
    this.links.delete(link.id)
    for (const id of [link.host, link.client]) {
      const p = this.peers.get(id)
      if (p && (p.role === 'client' || modernHost(p.version))) this.send(p, createControlFrame('error', { code, message: code, connectionId: link.id, retryable: true }))
    }
  }
  disconnect(id: string, code: string): void {
    const peer = this.peers.get(id)
    this.peers.delete(id)
    for (const link of this.links.values()) if (link.host === id || link.client === id) this.drop(link, code)
    if (peer) { peer.ws.close(code === 'CONNECTION_REPLACED' ? 4003 : 4001, code); setTimeout(() => peer.ws.terminate(), 1000).unref() }
  }
  private accept(ws: WebSocket): void {
    let peer: Peer | undefined
    const deadline = setTimeout(() => ws.terminate(), 5000)
    let windowStart = Date.now(), frames = 0, bytes = 0
    ws.on('error', () => {})
    ws.on('close', () => {
      clearTimeout(deadline)
      if (peer && this.peers.get(peer.id) === peer) this.disconnect(peer.id, 'CONNECTION_FAILED')
    })
    ws.on('message', (raw, binary) => {
      if (ws.readyState !== WebSocket.OPEN) return
      let frame: ControlFrame | undefined
      try {
        if (binary) throw new ApiError('INVALID_MESSAGE')
        const text = raw.toString()
        if (Date.now() - windowStart >= 1000) { windowStart = Date.now(); frames = 0; bytes = 0 }
        if (++frames > 512 || (bytes += Buffer.byteLength(text)) > 16 * MAX_RELAY_FRAME_BYTES) throw new ApiError('RATE_LIMITED')
        const envelope = JSON.parse(text) as { v?: unknown }
        if (envelope && envelope.v !== 1) throw new ApiError('UNSUPPORTED_VERSION')
        frame = decodeControlFrame(text)
        if (!peer) {
          if (frame.type !== 'hello') throw new ApiError('AUTH_REQUIRED')
          const p = frame.payload as HelloPayload
          const device = this.store.authenticate(p.accessToken).descriptor
          if (device.deviceId !== p.deviceId || device.role !== p.role) throw new ApiError('AUTH_INVALID')
          if (!p.protocols.includes(1)) throw new ApiError('UNSUPPORTED_VERSION')
          this.disconnect(device.deviceId, 'CONNECTION_REPLACED')
          peer = { ws, id: device.deviceId, role: device.role, capabilities: p.capabilities, version: p.clientVersion ?? device.clientVersion, lastPong: Date.now() }
          this.peers.set(peer.id, peer)
          clearTimeout(deadline)
          this.store.touch(peer.id, p.clientVersion, p.harnessVersion)
          this.send(peer, createControlFrame('hello.ack', { protocol: 1, serverVersion: 'self-hosted/0.1.0', connectionSessionId: randomUUID(), heartbeatIntervalMs: 25000, maxControlFrameBytes: MAX_CONTROL_FRAME_BYTES, maxRelayFrameBytes: MAX_RELAY_FRAME_BYTES, capabilities: p.capabilities.includes('transport.relay') ? ['transport.relay'] : [], webrtcEnabled: false, webrtcFallbackTimeoutMs: 1 }))
          return
        }
        if (this.peers.get(peer.id) !== peer) throw new ApiError('AUTH_INVALID')
        this.store.get(peer.id)
        this.handle(peer, frame)
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 'INVALID_MESSAGE'
        // Valid connection-scoped failures must not close the Host's other clients.
        const connectionId = (frame?.payload as { connectionId?: unknown } | undefined)?.connectionId
        if (peer && typeof connectionId === 'string' && code !== 'RATE_LIMITED') {
          const link = this.links.get(connectionId)
          if (link && (link.host === peer.id || link.client === peer.id)) this.drop(link, code)
          else this.send(peer, createControlFrame('error', { code, message: code, connectionId, retryable: false }))
          return
        }
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(createControlFrame('error', { code, message: code, retryable: false })))
        if (peer) this.disconnect(peer.id, code)
        else { ws.close(4001, code); setTimeout(() => ws.terminate(), 1000).unref() }
      }
    })
  }
  private handle(peer: Peer, frame: ControlFrame): void {
    const p = frame.payload as Record<string, unknown>
    if (frame.type === 'ping') { this.send(peer, createControlFrame('pong', { nonce: p.nonce })); return }
    if (frame.type === 'pong') {
      if (peer.nonce && p.nonce === peer.nonce) { peer.lastPong = Date.now(); peer.nonce = undefined }
      return
    }
    if (frame.type === 'connect.request') {
      const request = frame.payload as ConnectRequestPayload
      if (peer.role !== 'client') throw new ApiError('MEMBERSHIP_REQUIRED')
      const host = this.peers.get(request.hostDeviceId)
      if (!host || host.role !== 'host') { this.send(peer, createControlFrame('error', { code: 'HOST_OFFLINE', message: 'Host is offline.', retryable: true })); return }
      this.store.get(host.id)
      if (!request.preferredTransports.includes('relay') || !peer.capabilities.includes('transport.relay') || !host.capabilities.includes('transport.relay')) throw new ApiError('CAPABILITY_NOT_SUPPORTED')
      for (const old of this.links.values()) if (old.client === peer.id || (old.host === host.id && !modernHost(host.version))) this.drop(old, 'CONNECTION_REPLACED')
      if (this.links.size >= 256) throw new ApiError('RATE_LIMITED')
      const link: Link = { id: randomUUID(), host: host.id, client: peer.id, stage: 'pending', created: Date.now(), counters: new Map() }
      this.links.set(link.id, link)
      this.send(host, createControlFrame('connect.incoming', { connectionId: link.id, clientDeviceId: peer.id, clientIdentityKey: this.store.get(peer.id).descriptor.identityKey, authorization: 'account', preferredTransports: ['relay'] }))
      return
    }
    const id = p.connectionId
    const link = typeof id === 'string' ? this.links.get(id) : undefined
    if (!link || (peer.id !== link.host && peer.id !== link.client)) throw new ApiError('CONNECTION_NOT_FOUND')
    const otherId = peer.id === link.host ? link.client : link.host
    const other = this.peers.get(otherId)
    this.store.get(otherId)
    if (!other) throw new ApiError('CONNECTION_FAILED')
    if (frame.type === 'connect.accepted' || frame.type === 'connect.rejected') {
      if (peer.id !== link.host || link.stage !== 'pending') throw new ApiError('INVALID_MESSAGE')
      if (frame.type === 'connect.rejected') this.links.delete(link.id)
      else link.stage = 'accepted'
      this.send(other, frame)
      return
    }
    if (p.targetDeviceId !== otherId || link.stage === 'pending') throw new ApiError('CONNECTION_NOT_FOUND')
    if (frame.type === 'transport.selected') {
      if (peer.id !== link.client || (frame.payload as TransportSelectedPayload).transport !== 'relay') throw new ApiError('CAPABILITY_NOT_SUPPORTED')
      if (modernHost(other.version)) this.send(other, frame)
      return
    }
    if (frame.type.startsWith('signal.')) return // Relay-only negotiation: no signaling forwarding.
    if (frame.type === 'secure.handshake') {
      const step = (frame.payload as SecureHandshakePayload).step
      if (step === 1 && peer.id === link.client && link.stage === 'accepted') link.stage = 'handshake'
      else if (step === 2 && peer.id === link.host && link.stage === 'handshake') link.stage = 'ready'
      else throw new ApiError('INVALID_MESSAGE')
    } else if (frame.type === 'relay') {
      const counter = (frame.payload as RelayPayload).counter
      if (link.stage !== 'ready' || counter <= (link.counters.get(peer.id) ?? -1)) throw new ApiError('INVALID_MESSAGE')
      link.counters.set(peer.id, counter)
    } else throw new ApiError('INVALID_MESSAGE')
    this.send(other, frame)
  }
  close(): void { clearInterval(this.heartbeat); for (const ws of this.wss.clients) ws.terminate(); this.wss.close() }
}
