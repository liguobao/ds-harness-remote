import { generateKeyPair, NoiseIkSession, createNoisePrologue, fromBase64Url, toBase64Url } from '@dsh-remote/crypto'
import { createControlFrame, createRpcResponse, decodeMessage, encodeMessage, SecureMessageCodec } from '@dsh-remote/protocol'
import { expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { ClientModeRuntime } from '../src/client-runtime.js'
import { resolveConfig } from '../src/config.js'
import type { IdentityStore } from '../src/identity-store.js'
import type { ClientServerApi } from '../src/server-api.js'
import type { SafeLogger } from '../src/logging.js'

it('rechecks membership and pinned keys with a fresh Noise channel after relay loss, stopping on takeover or revocation', async () => {
  await runScenarios(['recover', 'sleep', 'long-outage', 'replaced', 'revoked', 'key-changed', 'replaced-during-discovery'].map(action => ({ name: action, run: async () => {
    const clientKeys = generateKeyPair(new Uint8Array(32).fill(41))
    const hostKeys = generateKeyPair(new Uint8Array(32).fill(42))
    const identity = { schemaVersion: 1, deviceId: 'client', name: 'Client', fingerprint: 'CLIENT', ...clientKeys }
    const host = { deviceId: 'host', name: 'Host', role: 'host', platform: 'linux', membershipId: 'member', identityKey: hostKeys.publicKey }
    const sockets: Socket[] = []
    class Socket {
      static OPEN = 1
      readyState = 0
      binaryType = ''
      onopen?: () => void
      onmessage?: (event: { data: string }) => void
      onclose?: (event: { code: number; reason: string }) => void
      readonly id = `connection-${sockets.length + 1}`
      private noise?: NoiseIkSession
      private incoming = new SecureMessageCodec()
      private outgoing = new SecureMessageCodec()
      private counter = 0
      constructor() { sockets.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.() }) }
      receive(type: Parameters<typeof createControlFrame>[0], payload: unknown) {
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(createControlFrame(type, payload)) }))
      }
      send(raw: string) {
        const frame = JSON.parse(raw)
        if (frame.type === 'hello') this.receive('hello.ack', {
          protocol: 1, serverVersion: 'test', connectionSessionId: this.id, heartbeatIntervalMs: 25000,
          maxControlFrameBytes: 65536, maxRelayFrameBytes: 1048576, capabilities: ['transport.relay'],
        })
        if (frame.type === 'connect.request') this.receive('connect.accepted', { connectionId: this.id })
        if (frame.type === 'secure.handshake') {
          this.noise = new NoiseIkSession({ role: 'responder', localPrivateKey: hostKeys.privateKey,
            localPublicKey: hostKeys.publicKey, remotePublicKey: clientKeys.publicKey,
            prologue: createNoisePrologue(this.id, 'host', 'client') })
          this.noise.readHandshake(fromBase64Url(frame.payload.data))
          this.receive('secure.handshake', { connectionId: this.id, targetDeviceId: 'client', step: 2, data: toBase64Url(this.noise.writeHandshake()) })
        }
        if (frame.type !== 'relay') return
        const message = this.incoming.decode(this.noise!.decrypt(fromBase64Url(frame.payload.ciphertext)))
        if (message === undefined) return
        const request = decodeMessage(message)
        const method = (request.payload as { method: string }).method
        if (method === 'harness.transport.describe' && sockets.length === 2 && action === 'replaced-during-discovery') {
          queueMicrotask(() => this.drop(4003))
          return
        }
        const result = method === 'harness.transport.describe'
          ? { capabilities: ['harness.remote.v1'] }
          : { ok: true, value: [{ id: 'original-session' }] }
        for (const plaintext of this.outgoing.encode(encodeMessage(createRpcResponse(request.id, result)))) {
          this.receive('relay', { connectionId: this.id, targetDeviceId: 'client', counter: this.counter++, ciphertext: toBase64Url(this.noise!.encrypt(plaintext)) })
        }
      }
      drop(code: number, reason = '') { this.readyState = 3; this.onclose?.({ code, reason }) }
      close() { this.readyState = 3; this.noise?.destroy() }
    }
    vi.stubGlobal('WebSocket', Socket)
    const server = { baseUrl: 'https://relay.test', bindIdentity() {},
      listDevices: vi.fn(async () => [host]), deviceFor: vi.fn(async () => host),
      presenceFor: async () => ({ online: true }), authenticate: vi.fn(async () => ({ accessToken: 'test-token' })),
    }
    const identities = { loadOrCreate: async () => identity,
      trustedPeer: () => ({ deviceId: 'host', name: 'Host', platform: 'linux', membershipId: 'member', publicKey: hostKeys.publicKey }),
    } as unknown as IdentityStore
    const local = vi.fn(async () => undefined)
    const gateway = { invoke: local, dispatchRpc: async () => ({ ok: true }),
      wireStream: { open: async () => (async function* () {})(), failure: () => ({ code: 'internal', message: '', details: {} }) } }
    const runtime = new ClientModeRuntime(resolveConfig({ forceRelay: true, reconnect: { initialDelayMs: 100, maxDelayMs: 30000, jitter: 0 } }),
      identities, server as unknown as ClientServerApi, gateway,
      { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as unknown as SafeLogger)
    try {
      await runtime.start()
      await runtime.setMode('remote', 'host')
      vi.useFakeTimers()
      if (action === 'revoked') server.listDevices.mockResolvedValue([])
      if (action === 'key-changed') server.deviceFor.mockResolvedValue({ ...host, identityKey: clientKeys.publicKey })
      const heartbeat = action === 'sleep' || action === 'long-outage'
      // Suspend the client's clock for eight hours without running its timers;
      // the Server's queued heartbeat close is delivered only on wake.
      if (heartbeat) vi.setSystemTime(Date.now() + 8 * 60 * 60 * 1000)
      const attempts: number[] = []
      if (action === 'long-outage') server.listDevices.mockImplementation(async () => {
        attempts.push(Date.now())
        throw Object.assign(new Error('Network is still offline after wake'), { code: 'CONNECTION_FAILED', retryable: true })
      })
      sockets[0]!.drop(heartbeat ? 4001 : action === 'replaced' ? 4003 : 1006, heartbeat ? 'CONNECTION_FAILED' : '')
      if (action === 'long-outage') {
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
        expect(runtime.status()).toMatchObject({ mode: 'remote', connected: false, recoveryGeneration: 0 })
        expect(attempts.length).toBeGreaterThan(50)
        expect(attempts.at(-1)! - attempts.at(-2)!).toBe(30000)
        expect(sockets).toHaveLength(1)
        server.listDevices.mockResolvedValue([host])
      }
      await vi.advanceTimersByTimeAsync(30000)
      const recovered = action === 'recover' || heartbeat
      expect(runtime.status()).toMatchObject({ mode: 'remote', connected: recovered, recoveryGeneration: recovered ? 1 : 0 })
      expect(server.listDevices).toHaveBeenCalledTimes(action === 'replaced' ? 1 : 2 + attempts.length)
      expect(server.authenticate).toHaveBeenCalledTimes(recovered || action === 'replaced-during-discovery' ? 2 : 1)
      if (recovered) {
        const invoke = gateway.invoke as (request: unknown) => Promise<unknown>
        await expect(invoke({ namespace: 'session', method: 'list', args: {} })).resolves.toEqual([{ id: 'original-session' }])
        expect(sockets.map(socket => socket.id)).toEqual(['connection-1', 'connection-2'])
      }
      expect(local).not.toHaveBeenCalled()
    } finally {
      await runtime.close()
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  } })))
})
