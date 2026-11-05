import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import {
  createControlFrame,
  decodeControlFrame,
  MAX_CONTROL_FRAME_BYTES,
  MAX_RELAY_FRAME_BYTES,
  SERVER_SHUTDOWN_CLOSE_CODE,
  SERVER_SHUTDOWN_CLOSE_REASON,
  type ControlFrame,
  type HelloPayload,
  type ConnectRequestPayload,
  type SecureHandshakePayload,
  type RelayPayload,
  type TransportSelectedPayload,
} from '@dsh-remote/protocol'
import { ApiError, Store } from './store.js'
import { Logger, type LogLevel } from './logger.js'
import { normalizeGatewayOptions, type GatewayTimingOptions } from './config.js'

export interface GatewayOptions extends GatewayTimingOptions {
  logLevel?: LogLevel
  logger?: Logger
}

/**
 * Connection lifecycle. Frames are only ever interpreted in `awaiting_hello`
 * or `authenticated`; `closing`/`closed` exists so a hello that loses the race
 * against the handshake deadline can never authenticate, register a peer,
 * touch the store or replace a healthy socket.
 */
type ConnectionState = 'awaiting_hello' | 'authenticated' | 'closing' | 'closed'

type Peer = { ws: WebSocket; id: string; role: 'host' | 'client'; capabilities: string[]; version: string; lastPong: number; nonce?: string }
type Link = { id: string; host: string; client: string; stage: 'pending' | 'accepted' | 'handshake' | 'ready'; created: number; counters: Map<string, number> }

function modernHost(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:\+.*)?$/.exec(version)
  if (!match) return false
  const [major, minor, patch] = match.slice(1).map(Number)
  return major! > 0 || (minor! > 2 || (minor === 2 && patch! >= 15))
}

const SAFE_TEXT = /^[A-Za-z0-9_.:-]+$/
const SAFE_PATH = /^[A-Za-z0-9/._~-]*$/
const SAFE_ADDRESS = /^[0-9a-fA-F:.]{2,45}$/
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9]{0,31}$/
const SAFE_ERROR_CODE = /^[A-Z0-9_]{1,32}$/

/** Diagnostics must never echo client-supplied text verbatim. */
function safeText(value: unknown, max = 64): string | undefined {
  return typeof value === 'string' && SAFE_TEXT.test(value) ? value.slice(0, max) : undefined
}

/** Parse the upgrade request path, dropping the query string (it may carry a token). */
function requestPath(rawUrl: string | undefined): string {
  if (typeof rawUrl !== 'string' || rawUrl === '') return ''
  const end = rawUrl.search(/[?#]/)
  const path = end === -1 ? rawUrl : rawUrl.slice(0, end)
  return SAFE_PATH.test(path) ? path.slice(0, 64) : '<invalid>'
}

function socketAddress(socket: unknown): string | undefined {
  try {
    const address = (socket as { remoteAddress?: unknown } | null)?.remoteAddress
    return typeof address === 'string' && SAFE_ADDRESS.test(address) ? address : undefined
  } catch {
    return undefined
  }
}

function errorName(error: unknown): string {
  try {
    const name = error instanceof Error ? error.name : undefined
    return typeof name === 'string' && SAFE_ERROR_NAME.test(name) ? name : 'Error'
  } catch {
    return 'Error'
  }
}

function errorCode(error: unknown): string | undefined {
  try {
    const code = (error as { code?: unknown } | null | undefined)?.code
    return typeof code === 'string' && SAFE_ERROR_CODE.test(code) ? code : undefined
  } catch {
    return undefined
  }
}

export class Gateway {
  readonly peers = new Map<string, Peer>()
  private links = new Map<string, Link>()
  private wss = new WebSocketServer({ noServer: true, maxPayload: MAX_RELAY_FRAME_BYTES, perMessageDeflate: false })
  private heartbeat: ReturnType<typeof setInterval>
  private closed = false
  readonly helloTimeoutMs: number
  readonly heartbeatIntervalMs: number
  readonly heartbeatDisconnectMs: number
  readonly forceTerminateGraceMs: number
  readonly logger: Logger

  constructor(server: Server, private store: Store, origin: string, options: GatewayOptions = {}) {
    // One normalization path for CLI and programmatic callers: NaN, Infinity,
    // negatives and out-of-range values degrade to documented defaults instead
    // of becoming 1ms timers.
    const timing = normalizeGatewayOptions(options)
    this.helloTimeoutMs = timing.helloTimeoutMs
    this.heartbeatIntervalMs = timing.heartbeatIntervalMs
    this.heartbeatDisconnectMs = timing.heartbeatDisconnectMs
    this.forceTerminateGraceMs = timing.forceTerminateGraceMs
    this.logger = options.logger ?? new Logger('gateway', options.logLevel ?? 'info')

    store.onInvalidate = id => this.disconnect(id, 'AUTH_INVALID')
    server.on('upgrade', (req, socket, head) => {
      const path = requestPath(req.url)
      // The route still requires an exact match: a query string is rejected
      // (exactly as before) but only its parsed pathname is ever logged.
      const pathRejected = req.url !== '/ws/v1/connect'
      const originRejected = Boolean(req.headers.origin) && req.headers.origin !== origin
      if (pathRejected || originRejected || this.wss.clients.size >= 256) {
        this.logger.warn('ws_upgrade_rejected', {
          // Parsed pathname only: the raw URL may carry credentials in its query.
          path: path === '' ? 'unknown' : path,
          reason: pathRejected
            ? 'invalid_url'
            : originRejected
              ? 'origin_mismatch'
              : 'connection_limit_reached',
          clientCount: this.wss.clients.size,
          hasOrigin: Boolean(req.headers.origin),
          remoteAddress: socketAddress(socket),
        })
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        return
      }
      this.wss.handleUpgrade(req, socket, head, ws => this.accept(ws))
    })
    this.heartbeat = setInterval(() => {
      if (this.closed) return
      for (const peer of this.peers.values()) {
        if (Date.now() - peer.lastPong > this.heartbeatDisconnectMs) {
          this.logger.warn('ws_heartbeat_timeout', {
            peerId: peer.id,
            role: peer.role,
            lastPong: peer.lastPong,
            elapsedMs: Date.now() - peer.lastPong,
            thresholdMs: this.heartbeatDisconnectMs,
          })
          this.disconnect(peer.id, 'CONNECTION_FAILED')
          continue
        }
        peer.nonce = randomUUID()
        this.send(peer, createControlFrame('ping', { nonce: peer.nonce }))
      }
      for (const link of this.links.values()) {
        if (link.stage !== 'ready' && Date.now() - link.created > 30_000) this.drop(link, 'CONNECTION_FAILED')
      }
    }, this.heartbeatIntervalMs)
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
    if (!peer) return
    this.logger.info('ws_peer_disconnected', { peerId: id, code })
    try {
      peer.ws.close(code === 'CONNECTION_REPLACED' ? 4003 : 4001, code)
    } catch {
      // Socket already closing: the grace below still forces termination.
    }
    const timer = setTimeout(() => {
      if (peer.ws.readyState !== WebSocket.CLOSED) peer.ws.terminate()
    }, this.forceTerminateGraceMs)
    timer.unref()
  }

  private accept(ws: WebSocket): void {
    let state: ConnectionState = 'awaiting_hello'
    let peer: Peer | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    let graceTimer: ReturnType<typeof setTimeout> | undefined

    // Timer cleanup is idempotent: every path (auth, timeout, close) can call
    // it any number of times without leaving a scheduled callback behind.
    const clearDeadline = (): void => {
      if (deadline === undefined) return
      clearTimeout(deadline)
      deadline = undefined
    }
    const clearGrace = (): void => {
      if (graceTimer === undefined) return
      clearTimeout(graceTimer)
      graceTimer = undefined
    }
    const terminateSoon = (target: WebSocket): void => {
      clearGrace()
      graceTimer = setTimeout(() => {
        graceTimer = undefined
        if (target.readyState !== WebSocket.CLOSED) target.terminate()
      }, this.forceTerminateGraceMs)
      graceTimer.unref()
    }

    this.logger.debug('ws_connection_accepted', { clientCount: this.wss.clients.size })

    deadline = setTimeout(() => {
      deadline = undefined
      if (state !== 'awaiting_hello') return
      // Close the door before closing the socket: any hello still in flight is
      // then discarded by the frame guard instead of authenticating late.
      state = 'closing'
      this.logger.warn('ws_hello_timeout', { timeoutMs: this.helloTimeoutMs, readyState: ws.readyState })
      if (ws.readyState === WebSocket.OPEN) {
        try {
          const frame = createControlFrame('error', {
            code: 'HELLO_TIMEOUT',
            message: `Hello handshake timed out after ${this.helloTimeoutMs}ms`,
            retryable: true,
          })
          ws.send(JSON.stringify(frame))
        } catch (error) {
          this.logger.warn('ws_hello_timeout_send_failed', { errorName: errorName(error) })
        }
      }
      try {
        ws.close(4001, 'CONNECTION_FAILED')
      } catch {
        // ws might not be closable in some edge states; the grace below terminates it.
      }
      terminateSoon(ws)
    }, this.helloTimeoutMs)
    deadline.unref()

    let windowStart = Date.now(), frames = 0, bytes = 0
    ws.on('error', (error) => {
      // Error messages can embed payload fragments: log the class and errno only.
      this.logger.warn('ws_socket_error', {
        peerId: peer?.id,
        errorName: errorName(error),
        errorCode: errorCode(error),
      })
    })
    ws.on('close', (code, reason) => {
      state = 'closed'
      clearDeadline()
      clearGrace()
      this.logger.debug('ws_connection_closed', {
        peerId: peer?.id,
        code,
        // The close reason is arbitrary client text: report only its presence.
        hasReason: Buffer.isBuffer(reason) ? reason.length > 0 : false,
      })
      if (peer && this.peers.get(peer.id) === peer) this.disconnect(peer.id, 'CONNECTION_FAILED')
    })
    ws.on('message', (raw, binary) => {
      // Frames arriving after the handshake deadline are dropped before any
      // parsing, authentication or store access can happen.
      if (state !== 'awaiting_hello' && state !== 'authenticated') return
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
        if (state === 'awaiting_hello') {
          if (frame.type !== 'hello') throw new ApiError('AUTH_REQUIRED')
          const p = frame.payload as HelloPayload
          const device = this.store.authenticate(p.accessToken).descriptor
          if (device.deviceId !== p.deviceId || device.role !== p.role) throw new ApiError('AUTH_INVALID')
          if (!p.protocols.includes(1)) throw new ApiError('UNSUPPORTED_VERSION')
          // Re-assert the state: if the deadline fired while credentials were
          // checked, the timeout wins and none of the side effects below run.
          if (state !== 'awaiting_hello') return
          state = 'authenticated'
          clearDeadline()
          this.disconnect(device.deviceId, 'CONNECTION_REPLACED')
          peer = { ws, id: device.deviceId, role: device.role, capabilities: p.capabilities, version: p.clientVersion ?? device.clientVersion, lastPong: Date.now() }
          this.peers.set(peer.id, peer)
          this.store.touch(peer.id, p.clientVersion, p.harnessVersion)
          this.logger.info('ws_hello_authenticated', {
            deviceId: safeText(peer.id),
            role: peer.role,
            clientVersion: safeText(peer.version),
            capabilities: peer.capabilities.filter(capability => typeof capability === 'string' && SAFE_TEXT.test(capability)).slice(0, 8),
          })
          this.send(peer, createControlFrame('hello.ack', {
            protocol: 1,
            serverVersion: 'self-hosted/0.1.0',
            connectionSessionId: randomUUID(),
            heartbeatIntervalMs: this.heartbeatIntervalMs,
            maxControlFrameBytes: MAX_CONTROL_FRAME_BYTES,
            maxRelayFrameBytes: MAX_RELAY_FRAME_BYTES,
            capabilities: p.capabilities.includes('transport.relay') ? ['transport.relay'] : [],
            webrtcEnabled: false,
            webrtcFallbackTimeoutMs: 1,
          }))
          return
        }
        if (frame.type === 'hello') throw new ApiError('INVALID_MESSAGE')
        if (!peer || this.peers.get(peer.id) !== peer) throw new ApiError('AUTH_INVALID')
        this.store.get(peer.id)
        this.handle(peer, frame)
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 'INVALID_MESSAGE'
        this.logger.warn('ws_message_error', {
          code,
          peerId: peer?.id,
          // Never log error.message: JSON parse failures echo the payload.
          errorName: errorName(error),
        })
        // Valid connection-scoped failures must not close the Host's other clients.
        const connectionId = (frame?.payload as { connectionId?: unknown } | undefined)?.connectionId
        if (peer && typeof connectionId === 'string' && code !== 'RATE_LIMITED') {
          const link = this.links.get(connectionId)
          if (link && (link.host === peer.id || link.client === peer.id)) { this.drop(link, code); return }
          this.send(peer, createControlFrame('error', { code, message: code, connectionId, retryable: false }))
          return
        }
        state = 'closing'
        clearDeadline()
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify(createControlFrame('error', { code, message: code, retryable: false }))) } catch { /* closing anyway */ }
        }
        if (peer) this.disconnect(peer.id, code)
        else {
          try { ws.close(4001, code) } catch { /* terminate below */ }
          terminateSoon(ws)
        }
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
  close(): void {
    if (this.closed) return
    this.closed = true
    clearInterval(this.heartbeat)
    this.logger.info('ws_gateway_closing', { clientCount: this.wss.clients.size })
    for (const ws of this.wss.clients) {
      // Give resumable clients an explicit, unambiguous shutdown signal. A
      // process restart is different from heartbeat failure (4001) and from
      // replacement/authentication failures, so clients can retain only the
      // bounded lease-backed session state.
      try {
        if (ws.readyState === WebSocket.OPEN) ws.close(SERVER_SHUTDOWN_CLOSE_CODE, SERVER_SHUTDOWN_CLOSE_REASON)
        else ws.terminate()
      } catch {
        // Force termination below.
      }
      const timer = setTimeout(() => { if (ws.readyState !== WebSocket.CLOSED) ws.terminate() }, this.forceTerminateGraceMs)
      timer.unref()
    }
    this.wss.close()
  }
}
