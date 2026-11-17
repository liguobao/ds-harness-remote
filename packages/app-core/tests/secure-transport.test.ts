import { describe, expect, it, vi } from 'vitest'
vi.mock('expo', () => ({ requireOptionalNativeModule: () => undefined }))
import { NoiseIkSession, createNoisePrologue, generateKeyPair } from '@dsh-remote/crypto'
import { SecureMessageCodec } from '@dsh-remote/protocol'
import type { SecureHandshakeTransport } from '@dsh-remote/webrtc'
import { SecureTransport } from '../src/services/secure-transport'
import type { DeviceIdentity, RemoteDevice } from '../src/types'

class HostLoopbackTransport implements SecureHandshakeTransport {
  handler?: (data: Uint8Array) => void
  handshakeHandler?: (step: number, data: Uint8Array) => void
  plaintexts: Uint8Array[] = []
  private readonly hostCodec = new SecureMessageCodec()
  private readonly hostIncoming = new SecureMessageCodec()
  private decoded: Uint8Array | undefined
  closed = false

  constructor(private readonly hostNoise: NoiseIkSession) {}

  async connect() {}

  async send(data: Uint8Array) {
    const plaintext = this.hostNoise.decrypt(data)
    this.plaintexts.push(plaintext)
    const message = this.hostIncoming.decode(plaintext)
    if (message !== undefined) this.decoded = message
  }

  getDecoded(): Uint8Array | undefined { return this.decoded }

  async sendHandshake(step: number, data: Uint8Array) {
    expect(step).toBe(1)
    this.hostNoise.readHandshake(data)
    this.handshakeHandler?.(2, this.hostNoise.writeHandshake())
  }

  connectionInfo() { return { connectionId: 'connection-1', localDeviceId: 'client', remoteDeviceId: 'host' } }

  onHandshake(handler: (step: number, data: Uint8Array) => void) {
    this.handshakeHandler = handler
    return () => { this.handshakeHandler = undefined }
  }

  onMessage(handler: (data: Uint8Array) => void) { this.handler = handler; return () => { this.handler = undefined } }

  async close() { this.closed = true }

  getStats() { return { mode: 'Relay' as const, connected: !this.closed } }

  sendFromHost(data: Uint8Array) { this.handler?.(this.hostNoise.encrypt(data)) }

  sendLargeFromHost(data: Uint8Array) {
    for (const fragment of this.hostCodec.encode(data)) {
      this.handler?.(this.hostNoise.encrypt(fragment))
    }
  }
}

function join(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const part of parts) { merged.set(part, offset); offset += part.byteLength }
  return merged
}

describe('secure transport', () => {
  it('performs Noise IK and protects both relay directions', async () => {
    const clientKeys = generateKeyPair(new Uint8Array(32).fill(1))
    const hostKeys = generateKeyPair(new Uint8Array(32).fill(2))
    const clientIdentity: DeviceIdentity = { deviceId: 'client', name: 'Phone', platform: 'android', ...clientKeys }
    const hostDevice: RemoteDevice = {
      deviceId: 'host', name: 'Host', platform: 'linux', online: true,
      identityKey: hostKeys.publicKey, membershipId: 'membership-1', trusted: true,
    }
    const hostNoise = new NoiseIkSession({
      role: 'responder',
      localPrivateKey: hostKeys.privateKey,
      localPublicKey: hostKeys.publicKey,
      remotePublicKey: clientKeys.publicKey,
      prologue: createNoisePrologue('connection-1', 'host', 'client'),
    })
    const wire = new HostLoopbackTransport(hostNoise)
    let handshakeStarted = false
    const client = new SecureTransport(wire, clientIdentity, hostDevice, () => { handshakeStarted = true })

    let received = ''
    client.onMessage(data => { received = new TextDecoder().decode(data) })
    await client.connect()
    expect(handshakeStarted).toBe(true)
    await client.send(new TextEncoder().encode('private session text'))
    expect(new TextDecoder().decode(join(wire.plaintexts))).toBe('private session text')

    wire.sendFromHost(new TextEncoder().encode('private response'))
    expect(received).toBe('private response')
  })

  it('fragments and reassembles large ApiProxy responses over the secure channel', async () => {
    const clientKeys = generateKeyPair(new Uint8Array(32).fill(3))
    const hostKeys = generateKeyPair(new Uint8Array(32).fill(4))
    const clientIdentity: DeviceIdentity = { deviceId: 'client', name: 'Phone', platform: 'android', ...clientKeys }
    const hostDevice: RemoteDevice = {
      deviceId: 'host', name: 'Host', platform: 'linux', online: true,
      identityKey: hostKeys.publicKey, membershipId: 'membership-1', trusted: true,
    }
    const hostNoise = new NoiseIkSession({
      role: 'responder',
      localPrivateKey: hostKeys.privateKey,
      localPublicKey: hostKeys.publicKey,
      remotePublicKey: clientKeys.publicKey,
      prologue: createNoisePrologue('connection-1', 'host', 'client'),
    })
    const wire = new HostLoopbackTransport(hostNoise)
    const client = new SecureTransport(wire, clientIdentity, hostDevice)

    const large = new TextEncoder().encode('x'.repeat(120_000))
    let received: Uint8Array | undefined
    client.onMessage(data => { received = data })
    await client.connect()
    await client.send(large)
    expect(new TextDecoder().decode(wire.getDecoded()!)).toBe(new TextDecoder().decode(large))

    wire.sendLargeFromHost(large)
    expect(received).toBeDefined()
    expect(received!.byteLength).toBe(large.byteLength)
    expect(new TextDecoder().decode(received!)).toBe(new TextDecoder().decode(large))
  })
})
