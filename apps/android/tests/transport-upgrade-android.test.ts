vi.mock('expo', () => ({ requireOptionalNativeModule: () => undefined }))
import { describe, expect, it, vi } from 'vitest'
import { generateKeyPair, NoiseIkSession, createNoisePrologue } from '@dsh-remote/crypto'
import { SecureMessageCodec } from '@dsh-remote/protocol'
import type { SecureHandshakeTransport, SequencedOutboundTransport } from '@dsh-remote/webrtc'
import { SecureTransport } from '../src/services/secure-transport'

function createPairedHandshake() {
  const clientKeys = generateKeyPair()
  const hostKeys = generateKeyPair()
  const connectionId = 'conn-android-upg'
  const hostNoise = new NoiseIkSession({
    role: 'responder',
    localPrivateKey: hostKeys.privateKey,
    localPublicKey: hostKeys.publicKey,
    remotePublicKey: clientKeys.publicKey,
    prologue: createNoisePrologue(connectionId, 'host-1', 'client-1'),
  })
  let onMsg: ((data: Uint8Array) => void) | undefined
  let onHs: ((step: number, data: Uint8Array) => void) | undefined
  const relayOutbound: Uint8Array[] = []
  const inner: SecureHandshakeTransport = {
    connect: async () => undefined,
    connectionInfo: () => ({ connectionId, localDeviceId: 'client-1', remoteDeviceId: 'host-1' }),
    sendHandshake: async (_step, data) => {
      hostNoise.readHandshake(data)
      onHs?.(2, hostNoise.writeHandshake())
    },
    onHandshake: cb => { onHs = cb; return () => { onHs = undefined } },
    send: async data => { relayOutbound.push(data) },
    onMessage: cb => { onMsg = cb; return () => { onMsg = undefined } },
    onClose: () => () => undefined,
    close: async () => undefined,
    getStats: () => ({ mode: 'Relay', connected: true, bytesSent: 0, bytesReceived: 0 }),
  }
  return { clientKeys, hostKeys, hostNoise, inner, relayOutbound, deliverRelay: (cipher: Uint8Array) => onMsg?.(cipher) }
}

describe('Android SecureTransport live upgrade & cross-leg reorder', () => {
  it('switches outbound leg without re-handshaking, tracks Relay byte cost separately, and reorders fast DataChannel frames overtaking Relay frames', async () => {
    const { clientKeys, hostKeys, hostNoise, inner, relayOutbound, deliverRelay } = createPairedHandshake()
    const secure = new SecureTransport(
      inner,
      { deviceId: 'client-1', name: 'Phone', platform: 'android', publicKey: clientKeys.publicKey, privateKey: clientKeys.privateKey },
      { deviceId: 'host-1', name: 'Mac', platform: 'darwin', identityKey: hostKeys.publicKey, membershipId: 'm1', online: true, trusted: true },
    )
    const received: string[] = []
    secure.onMessage(msg => received.push(new TextDecoder().decode(msg)))
    await secure.connect()

    // 1. Send initial RPC over Relay -> counted in relayTrafficBytes
    await secure.send(new TextEncoder().encode('hello-relay'))
    expect(relayOutbound).toHaveLength(1)
    expect(secure.relayTrafficBytes().sent).toBeGreaterThan(0)
    const relaySentBeforeUpgrade = secure.relayTrafficBytes().sent

    // 2. Attach upgraded LAN leg and switch outbound
    let onSeq: ((counter: number, cipher: Uint8Array) => void) | undefined
    const dcSent: Array<{ counter: number; cipher: Uint8Array }> = []
    const lanLeg: SequencedOutboundTransport = {
      isSequencedUpgradeLeg: true,
      mode: 'LAN',
      selectedTransport: 'lan',
      connect: async () => undefined,
      send: async () => { throw new Error('unused') },
      sendSequenced: async (counter, cipher) => { dcSent.push({ counter, cipher }) },
      onSequencedMessage: cb => { onSeq = cb; return () => { onSeq = undefined } },
      onMessage: () => () => undefined,
      onClose: () => () => undefined,
      close: async () => undefined,
      getStats: () => ({ mode: 'LAN', connected: true, bytesSent: 100, bytesReceived: 200 }),
      connectionDetails: async () => ({ mode: 'LAN', transport: 'lan', connectionState: 'connected', iceConnectionState: 'connected', diagnostics: {} as never }),
    }

    secure.attachIncomingLeg(lanLeg)
    const endCounter = await secure.switchOutboundLeg(lanLeg, { closePrevious: true })
    expect(endCounter).toBe(1)
    expect(secure.getStats().mode).toBe('LAN')

    // 3. Subsequent outbound messages traverse LAN DataChannel with counter=1 and ZERO extra Relay bytes!
    await secure.send(new TextEncoder().encode('hello-lan'))
    expect(dcSent).toHaveLength(1)
    expect(dcSent[0]!.counter).toBe(1)
    expect(secure.relayTrafficBytes().sent).toBe(relaySentBeforeUpgrade)

    // 4. Host sends counter 0 on Relay (slow) and counter 1 on LAN DataChannel (arrives first!)
    const hostCodec = new SecureMessageCodec()
    const c0 = hostNoise.encrypt(hostCodec.encode(new TextEncoder().encode('snap-0'))[0]!)
    const c1 = hostNoise.encrypt(hostCodec.encode(new TextEncoder().encode('delta-1'))[0]!)

    onSeq?.(1, c1) // Fast LAN frame arrives first!
    expect(received).toEqual([])
    deliverRelay(c0) // Trailing Relay frame arrives -> both decrypt in order!
    expect(received).toEqual(['snap-0', 'delta-1'])

    await secure.close()
  })
})
