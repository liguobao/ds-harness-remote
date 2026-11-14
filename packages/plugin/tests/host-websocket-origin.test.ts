import { createServer, type Server } from 'node:http'
import { generateKeyPair } from '@dsh-remote/crypto'
import {
  createControlFrame,
  createRelayDataFrame,
  decodeControlFrame,
  decodeRelayDataFrame,
  encodeRelayDataFrame,
} from '@dsh-remote/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket as NodeWebSocket, WebSocketServer } from 'ws'
import type { ConnectionController } from '../src/connection-controller.js'
import type { ResolvedConfig } from '../src/config.js'
import type { HostIdentity, IdentityStore } from '../src/identity-store.js'
import type { SafeLogger } from '../src/logging.js'
import { createNodeWebSocket } from '../src/node-websocket.js'
import type { HostServerApi } from '../src/server-api.js'
import type { WebSocketFactory } from '../src/server-connection.js'

// Opt in to exercising the committed release artifact, including its bundled ws.
const releaseBundle = process.env.DSH_TEST_RELEASE_BUNDLE === '1'
const { HostServerConnection } = await (releaseBundle
  ? import(/* @vite-ignore */ new URL('../dist/index.js', import.meta.url).href)
  : import('../src/server-connection.js')) as typeof import('../src/server-connection.js')

/**
 * #353 Host-only coverage: real bundled `ws` + a local Server that mirrors
 * Gateway Origin checks (reject Origin ≠ DSH_SERVER_PUBLIC_URL).
 *
 * AdaptiveTransport / RelayTransport / browser globals are intentionally
 * unchanged; a regression case below asserts the browser default still uses
 * globalThis.WebSocket.
 */

const PUBLIC_ORIGIN = 'http://10.10.10.30:8081'
const PAGE_ORIGIN = 'http://127.0.0.1:3080'

interface UpgradeRecord {
  origin: string | undefined
  url: string
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Host WebSocket Origin gate (#353)', () => {
  it.runIf(releaseBundle)('times out a pending release-bundle ws upgrade and stops cleanly', async () => {
    const gate = await listenGate({ holdUpgrade: true })
    const unhandled = trackUnhandled()
    const host = hostConnection(gate.baseUrl)
    try {
      host.server.start()
      await vi.waitFor(() => expect(gate.upgrades.length).toBe(1))
      await vi.waitFor(() => expect(host.server.lastError()).toBe('CONNECTION_FAILED'), { timeout: 35_000, interval: 100 })
      await host.server.stop()
      await settle()
      expect(host.server.isOnline()).toBe(false)
      expect(host.server.isReconnecting()).toBe(false)
      unhandled.expectClean()
    } finally {
      await host.server.stop()
      unhandled.stop()
      await gate.close()
    }
  }, 40_000)

  it.runIf(releaseBundle)('times out a release-bundle socket without hello.ack and closes it', async () => {
    const gate = await listenGate({ noHello: true })
    const unhandled = trackUnhandled()
    const host = hostConnection(gate.baseUrl)
    try {
      host.server.start()
      await vi.waitFor(() => expect(gate.controlSockets.length).toBe(1))
      await vi.waitFor(() => expect(host.server.lastError()).toBe('CONNECTION_FAILED'), { timeout: 15_000, interval: 100 })
      await host.server.stop()
      await settle()
      expect(openCount(gate.controlSockets)).toBe(0)
      unhandled.expectClean()
    } finally {
      await host.server.stop()
      unhandled.stop()
      await gate.close()
    }
  }, 20_000)

  it('createNodeWebSocket omits Origin and is accepted when the public URL differs from the page Origin', async () => {
    const gate = await listenGate()
    const unhandled = trackUnhandled()
    try {
      const socket = createNodeWebSocket(`${gate.baseUrl.replace('http', 'ws')}/ws/v1/connect`)
      await onceOpen(socket)
      socket.close(1000, 'done')
      await onceClose(socket)
      expect(gate.upgrades.map(entry => entry.origin)).toEqual([undefined])
      unhandled.expectClean()
    } finally {
      unhandled.stop()
      await gate.close()
    }
  })

  it('rejects an Origin-bearing upgrade the way a self-hosted Server rejects dsh web globals', async () => {
    const gate = await listenGate()
    const unhandled = trackUnhandled()
    try {
      const socket = new NodeWebSocket(`${gate.baseUrl.replace('http', 'ws')}/ws/v1/connect`, {
        origin: PAGE_ORIGIN,
        perMessageDeflate: false,
      })
      await Promise.race([onceClose(socket), onceError(socket)])
      expect(gate.upgrades.map(entry => entry.origin)).toEqual([PAGE_ORIGIN])
      expect(gate.controlSockets).toHaveLength(0)
      unhandled.expectClean()
    } finally {
      unhandled.stop()
      await gate.close()
    }
  })

  it('HostServerConnection default factory brings the Host online without Origin on control and Relay data', async () => {
    const gate = await listenGate({ relayAttach: true })
    const unhandled = trackUnhandled()
    const peerKey = generateKeyPair(new Uint8Array(32).fill(71)).publicKey
    const host = hostConnection(gate.baseUrl)
    try {
      host.server.start()
      await vi.waitFor(() => expect(host.server.isOnline()).toBe(true))
      expect(gate.upgrades.every(entry => entry.origin === undefined)).toBe(true)
      expect(gate.upgrades.some(entry => entry.url === '/ws/v1/connect')).toBe(true)

      const control = gate.controlSockets[0]!
      control.send(JSON.stringify(createControlFrame('connect.incoming', {
        connectionId: 'connection-relay',
        clientDeviceId: 'client-1',
        clientIdentityKey: peerKey,
        authorization: 'account',
        preferredTransports: ['relay'],
        relayEndpoint: gate.relayUrl,
        relayTicket: 'dshrt.host-ticket',
        relayNodeId: 'relay-1',
        relayEpoch: 4,
      })))
      await vi.waitFor(() => expect(gate.hostFrames.some(frame => frame.type === 'connect.accepted')).toBe(true))
      control.send(JSON.stringify(createControlFrame('transport.selected', {
        connectionId: 'connection-relay',
        targetDeviceId: host.identity.deviceId,
        transport: 'relay',
      })))
      await vi.waitFor(() => expect(gate.dataSockets.length).toBeGreaterThanOrEqual(1))
      expect(gate.upgrades.filter(entry => entry.url.startsWith('/relay')).every(entry => entry.origin === undefined)).toBe(true)
      await vi.waitFor(() => expect(gate.dataSockets.some(socket => socket.readyState === NodeWebSocket.OPEN)).toBe(true))
      unhandled.expectClean()
    } finally {
      await host.server.stop()
      await settle()
      expect(openCount(gate.controlSockets)).toBe(0)
      expect(openCount(gate.dataSockets)).toBe(0)
      unhandled.expectClean()
      unhandled.stop()
      await gate.close()
    }
  })

  it('reconnects control after Server drop without Origin and without duplicate live sockets', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const gate = await listenGate()
    const unhandled = trackUnhandled()
    const host = hostConnection(gate.baseUrl, {
      enabled: true, initialDelayMs: 10, maxDelayMs: 20, jitter: 0,
    })
    try {
      host.server.start()
      await vi.waitFor(() => expect(host.server.isOnline()).toBe(true))
      const before = gate.upgrades.length
      const firstControl = gate.controlSockets[0]!
      gate.dropControl()
      await vi.waitFor(() => expect(gate.upgrades.length).toBeGreaterThan(before), { timeout: 5_000 })
      await vi.waitFor(() => expect(host.server.isOnline()).toBe(true), { timeout: 5_000 })
      expect(gate.upgrades.every(entry => entry.origin === undefined)).toBe(true)
      expect(openCount(gate.controlSockets)).toBe(1)
      expect(gate.controlSockets.some(socket => socket !== firstControl && socket.readyState === NodeWebSocket.OPEN)).toBe(true)
      unhandled.expectClean()
    } finally {
      await host.server.stop()
      await settle()
      expect(openCount(gate.controlSockets)).toBe(0)
      unhandled.expectClean()
      unhandled.stop()
      await gate.close()
    }
  })

  it('recovers after abrupt control reset without Origin and without accumulating open sockets', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const gate = await listenGate()
    const unhandled = trackUnhandled()
    const host = hostConnection(gate.baseUrl, {
      enabled: true, initialDelayMs: 10, maxDelayMs: 20, jitter: 0,
    })
    try {
      host.server.start()
      await vi.waitFor(() => expect(host.server.isOnline()).toBe(true))
      const before = gate.upgrades.length
      const live = gate.controlSockets.find(socket => socket.readyState === NodeWebSocket.OPEN)
      expect(live).toBeDefined()
      live!.terminate()
      await vi.waitFor(() => expect(gate.upgrades.length).toBeGreaterThan(before), { timeout: 5_000 })
      await vi.waitFor(() => expect(host.server.isOnline()).toBe(true), { timeout: 5_000 })
      expect(gate.upgrades.every(entry => entry.origin === undefined)).toBe(true)
      expect(openCount(gate.controlSockets)).toBe(1)
      unhandled.expectClean()
    } finally {
      await host.server.stop()
      await settle()
      expect(openCount(gate.controlSockets)).toBe(0)
      unhandled.expectClean()
      unhandled.stop()
      await gate.close()
    }
  })

  it('stops cleanly while online and clears sockets and timers', async () => {
    const gate = await listenGate()
    const unhandled = trackUnhandled()
    const host = hostConnection(gate.baseUrl, {
      enabled: true, initialDelayMs: 10, maxDelayMs: 20, jitter: 0,
    })
    try {
      host.server.start()
      await vi.waitFor(() => expect(host.server.isOnline()).toBe(true))
      await host.server.stop()
      await settle()
      expect(host.server.isOnline()).toBe(false)
      expect(host.server.isReconnecting()).toBe(false)
      expect(openCount(gate.controlSockets)).toBe(0)
      unhandled.expectClean()
    } finally {
      unhandled.stop()
      await gate.close()
    }
  })

  it('cancels a pending upgrade without unhandled errors or leaked sockets', async () => {
    const gate = await listenGate({ holdUpgrade: true })
    const unhandled = trackUnhandled()
    const host = hostConnection(gate.baseUrl)
    try {
      host.server.start()
      await vi.waitFor(() => expect(gate.upgrades.length).toBeGreaterThanOrEqual(1), { timeout: 5_000 })
      expect(host.server.isOnline()).toBe(false)
      await host.server.stop()
      await settle()
      expect(host.server.isOnline()).toBe(false)
      expect(host.server.isReconnecting()).toBe(false)
      expect(openCount(gate.controlSockets)).toBe(0)
      unhandled.expectClean()
    } finally {
      gate.releaseHeld()
      unhandled.stop()
      await gate.close()
    }
  })

  it('handles Origin-rejected upgrades without unhandled errors and without staying online', async () => {
    const gate = await listenGate()
    const unhandled = trackUnhandled()
    const withPageOrigin: WebSocketFactory = url => new NodeWebSocket(url, {
      origin: PAGE_ORIGIN,
      perMessageDeflate: false,
    }) as unknown as ReturnType<WebSocketFactory>
    const host = hostConnection(gate.baseUrl, undefined, withPageOrigin)
    try {
      host.server.start()
      await settle(300)
      expect(host.server.isOnline()).toBe(false)
      expect(gate.upgrades.some(entry => entry.origin === PAGE_ORIGIN)).toBe(true)
      expect(gate.controlSockets).toHaveLength(0)
      await host.server.stop()
      await settle()
      unhandled.expectClean()
    } finally {
      unhandled.stop()
      await gate.close()
    }
  })

  it('survives repeated reconnect cycles without duplicate live control sockets', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const gate = await listenGate()
    const unhandled = trackUnhandled()
    const host = hostConnection(gate.baseUrl, {
      enabled: true, initialDelayMs: 10, maxDelayMs: 20, jitter: 0,
    })
    try {
      host.server.start()
      await vi.waitFor(() => expect(host.server.isOnline()).toBe(true))
      for (let cycle = 0; cycle < 3; cycle++) {
        const before = gate.upgrades.length
        gate.dropControl()
        await vi.waitFor(() => expect(gate.upgrades.length).toBeGreaterThan(before), { timeout: 5_000 })
        await vi.waitFor(() => expect(host.server.isOnline()).toBe(true), { timeout: 5_000 })
        expect(openCount(gate.controlSockets)).toBe(1)
      }
      expect(gate.upgrades.every(entry => entry.origin === undefined)).toBe(true)
      unhandled.expectClean()
    } finally {
      await host.server.stop()
      await settle()
      expect(openCount(gate.controlSockets)).toBe(0)
      unhandled.expectClean()
      unhandled.stop()
      await gate.close()
    }
  })
})

describe('browser / shared transport defaults (regression)', () => {
  it('AdaptiveTransport still constructs sockets via the global WebSocket by default', async () => {
    const { AdaptiveTransport } = await import('@dsh-remote/webrtc')
    const GlobalWebSocket = vi.fn(function Fake(this: { url: string }, url: string) {
      this.url = url
      return {
        url,
        readyState: 0,
        binaryType: '',
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        send: vi.fn(),
        close: vi.fn(),
      }
    })
    vi.stubGlobal('WebSocket', Object.assign(GlobalWebSocket, { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 }))
    const transport = new AdaptiveTransport('wss://remote.example/ws/v1/connect', {
      role: 'client',
      deviceId: 'client-1',
      accessToken: 'token',
      targetDeviceId: 'host-1',
      forceRelay: true,
    })
    const connecting = transport.connect()
    expect(GlobalWebSocket).toHaveBeenCalledWith('wss://remote.example/ws/v1/connect')
    await transport.close()
    await expect(connecting).rejects.toThrow()
  })
})

function hostConnection(
  baseUrl: string,
  reconnect?: ResolvedConfig['reconnect'],
  createWebSocket?: WebSocketFactory,
) {
  const identity: HostIdentity = {
    schemaVersion: 1,
    deviceId: 'host-origin',
    name: 'Host',
    fingerprint: 'HOST',
    ...generateKeyPair(new Uint8Array(32).fill(17)),
  }
  const api = {
    baseUrl,
    authenticate: vi.fn(async () => ({ accessToken: 'access-token' })),
    deviceFor: vi.fn(async () => ({
      deviceId: 'client-1',
      name: 'Phone',
      role: 'client',
      platform: 'android',
      identityKey: generateKeyPair(new Uint8Array(32).fill(71)).publicKey,
      membershipId: 'membership-1',
    })),
  } as unknown as HostServerApi
  const server = new HostServerConnection(
    {
      terminal: { enabled: false },
      httpServerAllowlist: [],
      sidebar: { entry: 'standard' },
      loopback: { ports: [] },
      enabled: true,
      role: 'host',
      serverUrl: baseUrl,
      deviceName: 'Host',
      forceRelay: true,
      rotatePinnedPeerKey: false,
      logLevel: 'error',
      reconnect: reconnect ?? { enabled: false, initialDelayMs: 10, maxDelayMs: 20, jitter: 0 },
      codex: { enabled: false, binary: 'codex' },
      cursor: { enabled: false, binary: 'agent' },
    },
    identity,
    {
      trustedPeer: vi.fn(() => undefined),
      trustPeer: vi.fn(async input => ({ ...input, fingerprint: 'CLIENT', trustedAt: 1 })),
    } as unknown as IdentityStore,
    api,
    {
      accept: vi.fn(async () => undefined),
      closeConnection: vi.fn(async () => true),
      close: vi.fn(async () => undefined),
    } as unknown as ConnectionController,
    { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SafeLogger,
    createWebSocket,
  )
  return { server, api, identity }
}

async function listenGate(options: { relayAttach?: boolean; holdUpgrade?: boolean; noHello?: boolean } = {}) {
  const upgrades: UpgradeRecord[] = []
  const controlSockets: NodeWebSocket[] = []
  const dataSockets: NodeWebSocket[] = []
  const hostFrames: Array<{ type: string }> = []
  // Node types `upgrade` sockets as Duplex; we only need destroy/end for cleanup.
  const held: Array<{ destroy(): void }> = []
  const http: Server = createServer((_req, res) => {
    res.writeHead(404)
    res.end()
  })
  const wss = new WebSocketServer({ noServer: true })
  http.on('upgrade', (req, socket, head) => {
    const url = req.url ?? ''
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
    upgrades.push({ origin, url })
    if (origin && origin !== PUBLIC_ORIGIN) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    if (options.holdUpgrade) {
      held.push(socket)
      return
    }
    wss.handleUpgrade(req, socket, head, ws => {
      if (url.startsWith('/relay')) {
        dataSockets.push(ws)
        ws.on('message', raw => {
          try {
            const frame = decodeRelayDataFrame(typeof raw === 'string' ? raw : raw.toString())
            if (frame.type === 'relay.attach') {
              ws.send(encodeRelayDataFrame(createRelayDataFrame('relay.ready', {
                connectionId: frame.payload.connectionId,
                epoch: 4,
              })))
            }
          } catch {
            ws.close(1002, 'bad relay frame')
          }
        })
        return
      }
      controlSockets.push(ws)
      ws.on('message', raw => {
        try {
          const frame = decodeControlFrame(typeof raw === 'string' ? raw : raw.toString())
          hostFrames.push({ type: frame.type })
          if (frame.type === 'hello' && !options.noHello) {
            ws.send(JSON.stringify(createControlFrame('hello.ack', {
              protocol: 1,
              serverVersion: 'test',
              connectionSessionId: `control-${controlSockets.length}`,
              heartbeatIntervalMs: 25_000,
              maxControlFrameBytes: 65_536,
              maxRelayFrameBytes: 1_048_576,
              capabilities: options.relayAttach
                ? ['transport.relay', 'transport.relay.attach']
                : ['transport.relay'],
            })))
          }
        } catch {
          ws.close(1002, 'bad control frame')
        }
      })
    })
  })
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (http.address() as { port: number }).port
  const baseUrl = `http://127.0.0.1:${port}`
  return {
    baseUrl,
    relayUrl: `${baseUrl.replace('http', 'ws')}/relay`,
    upgrades,
    controlSockets,
    dataSockets,
    hostFrames,
    dropControl() {
      for (const socket of [...controlSockets]) {
        if (socket.readyState === NodeWebSocket.OPEN) socket.close(1001, 'server restart')
      }
    },
    releaseHeld() {
      for (const entry of held.splice(0)) {
        try { entry.destroy() } catch { /* ignore */ }
      }
    },
    async close() {
      for (const entry of held.splice(0)) {
        try { entry.destroy() } catch { /* ignore */ }
      }
      for (const socket of [...controlSockets, ...dataSockets]) {
        try { socket.terminate() } catch { /* ignore */ }
      }
      await new Promise<void>(resolve => wss.close(() => resolve()))
      await new Promise<void>((resolve, reject) => {
        http.close(error => error ? reject(error) : resolve())
      })
    },
  }
}

function trackUnhandled() {
  const errors: unknown[] = []
  const onRejection = (reason: unknown) => { errors.push(reason) }
  const onException = (error: Error) => { errors.push(error) }
  process.on('unhandledRejection', onRejection)
  process.on('uncaughtException', onException)
  return {
    expectClean() {
      expect(errors, errors[0] instanceof Error ? errors[0].stack : String(errors[0])).toEqual([])
    },
    stop() {
      process.off('unhandledRejection', onRejection)
      process.off('uncaughtException', onException)
    },
  }
}

function openCount(sockets: NodeWebSocket[]): number {
  return sockets.filter(socket => socket.readyState === NodeWebSocket.OPEN).length
}

function onceOpen(socket: NodeWebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
}

function onceClose(socket: NodeWebSocket): Promise<void> {
  return new Promise(resolve => { socket.once('close', () => resolve()) })
}

function onceError(socket: NodeWebSocket): Promise<Error> {
  return new Promise(resolve => {
    socket.once('error', error => resolve(error instanceof Error ? error : new Error(String(error))))
  })
}

function settle(ms = 50): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
