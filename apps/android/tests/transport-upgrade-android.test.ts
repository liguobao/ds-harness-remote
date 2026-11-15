vi.mock('expo', () => ({ requireOptionalNativeModule: () => undefined }))
import { describe, expect, it, vi } from 'vitest'
import { generateKeyPair, NoiseIkSession, createNoisePrologue } from '@dsh-remote/crypto'
import { ClientLiveTransportUpgrader, RemoteClientCore } from '@dsh-remote/client-core'
import {
  SecureMessageCodec,
  createRpcResponse,
  decodeMessage,
  encodeMessage,
  unwrapUpgradedTransportFrame,
  wrapUpgradedTransportFrame,
  type RemoteMessage,
} from '@dsh-remote/protocol'
import {
  RtcChunkCodec,
  type RtcDataChannel,
  type RtcPeerConnection,
  type RtcPeerConnectionFactory,
  type RtcStats,
  type SecureHandshakeTransport,
  type SequencedOutboundTransport,
} from '@dsh-remote/webrtc'
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

function makeStats(tier: 'LAN' | 'P2P' | 'TURN'): RtcStats {
  const localType = tier === 'TURN' ? 'relay' : tier === 'P2P' ? 'srflx' : 'host'
  const localAddr = tier === 'LAN' ? '192.168.1.10' : '203.0.113.10'
  const remoteAddr = tier === 'LAN' ? '192.168.1.20' : '198.51.100.20'
  return new Map([
    ['L1', { id: 'L1', type: 'local-candidate', candidateType: localType, address: localAddr }],
    ['R1', { id: 'R1', type: 'remote-candidate', candidateType: localType === 'relay' ? 'srflx' : localType, address: remoteAddr }],
    ['P1', { id: 'P1', type: 'candidate-pair', localCandidateId: 'L1', remoteCandidateId: 'R1', state: 'succeeded', nominated: true }],
    ['T1', { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' }],
  ])
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

    await secure.send(new TextEncoder().encode('hello-relay'))
    expect(relayOutbound).toHaveLength(1)
    const relaySentBeforeUpgrade = secure.relayTrafficBytes().sent

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

    await secure.send(new TextEncoder().encode('hello-lan'))
    expect(dcSent).toHaveLength(1)
    expect(dcSent[0]!.counter).toBe(1)
    expect(secure.relayTrafficBytes().sent).toBe(relaySentBeforeUpgrade)

    const hostCodec = new SecureMessageCodec()
    const c0 = hostNoise.encrypt(hostCodec.encode(new TextEncoder().encode('snap-0'))[0]!)
    const c1 = hostNoise.encrypt(hostCodec.encode(new TextEncoder().encode('delta-1'))[0]!)

    onSeq?.(1, c1)
    expect(received).toEqual([])
    deliverRelay(c0)
    expect(received).toEqual(['snap-0', 'delta-1'])

    await secure.close()
  })

  it('survives old P2P DataChannel closing as soon as drain RPC arrives on second upgrade (P2P -> LAN)', async () => {
    const { clientKeys, hostKeys, hostNoise, inner } = createPairedHandshake()
    const hostIncoming = new SecureMessageCodec()
    const hostOutgoing = new SecureMessageCodec()
    let tier: 'P2P' | 'LAN' = 'P2P'
    const clientDcs: RtcDataChannel[] = []
    const drainWatermarks: number[] = []

    const hostRtcChunkOut = new RtcChunkCodec()
    const hostRtcChunkIn = new RtcChunkCodec()
    const sendFromHostOnDc = (dcIndex: number, msg: RemoteMessage, delayMs = 0) => {
      const encoded = encodeMessage(msg)
      for (const pt of hostOutgoing.encode(encoded)) {
        const cipher = hostNoise.encrypt(pt)
        const ctr = Number(hostNoise.sendingCounter() - 1n)
        const framed = wrapUpgradedTransportFrame(ctr, cipher)
        for (const rtch of hostRtcChunkOut.encode(framed)) {
          const buf = rtch.buffer.slice(rtch.byteOffset, rtch.byteOffset + rtch.byteLength) as ArrayBuffer
          const deliver = () => clientDcs[dcIndex]?.onmessage?.({ data: buf })
          if (delayMs > 0) setTimeout(deliver, delayMs)
          else deliver()
        }
      }
    }

    // Intercept Relay sends during first upgrade
    inner.send = async cipher => {
      const pt = hostIncoming.decode(hostNoise.decrypt(cipher))
      if (!pt) return
      const req = decodeMessage(pt) as RemoteMessage<{ method: string; params: Record<string, unknown> }>
      if (req.payload.method === 'remote.transport.upgrade.offer') {
        sendFromHostOnRelay(createRpcResponse(req.id, { attemptId: req.payload.params.attemptId, sdp: 'v=0\r\nans' }))
      } else if (req.payload.method === 'remote.transport.upgrade.activate') {
        sendFromHostOnDc(0, createRpcResponse(req.id, { activated: true, mode: 'P2P', previousLegEndCounter: Number(hostNoise.sendingCounter()) }))
      }
    }
    let relaySeqCb: ((ctr: number | undefined, d: Uint8Array) => void) | undefined
    inner.onSequencedMessage = cb => { relaySeqCb = cb; return () => { relaySeqCb = undefined } }
    const sendFromHostOnRelay = (msg: RemoteMessage) => {
      for (const pt of hostOutgoing.encode(encodeMessage(msg))) {
        const cipher = hostNoise.encrypt(pt)
        const ctr = Number(hostNoise.sendingCounter() - 1n)
        relaySeqCb?.(ctr, cipher)
      }
    }

    const factory: RtcPeerConnectionFactory = {
      create() {
        const idx = clientDcs.length
        const dc: RtcDataChannel = {
          label: 'dsh', ordered: true, readyState: 'connecting', bufferedAmount: 0, binaryType: 'arraybuffer',
          onopen: null, onmessage: null, onclose: null, onerror: null, onbufferedamountlow: null,
          send: raw => {
            if (dc.readyState !== 'open') throw new Error('DC already closed')
            const assembled = hostRtcChunkIn.decode(new Uint8Array(raw as ArrayBuffer))
            if (!assembled) return
            const { ciphertext } = unwrapUpgradedTransportFrame(assembled)
            const pt = hostIncoming.decode(hostNoise.decrypt(ciphertext))
            if (!pt) return
            const req = decodeMessage(pt) as RemoteMessage<{ method: string; params: Record<string, unknown> }>
            if (req.payload.method === 'remote.transport.upgrade.offer') {
              sendFromHostOnDc(idx, createRpcResponse(req.id, { attemptId: req.payload.params.attemptId, sdp: 'v=0\r\nans2' }))
            } else if (req.payload.method === 'remote.transport.upgrade.activate') {
              // Host does NOT close dc[0] during activate; responds on new dc[1] after 25ms!
              sendFromHostOnDc(1, createRpcResponse(req.id, { activated: true, mode: 'LAN', previousLegEndCounter: Number(hostNoise.sendingCounter()) }), 25)
            } else if (req.payload.method === 'remote.transport.upgrade.drain') {
              drainWatermarks.push(req.payload.params.previousLegEndCounter as number)
              if (idx === 1) {
                // On 2nd hop (P2P -> LAN), immediately close superseded P2P dc[0] firing real client dc.onclose()!
                clientDcs[0]!.readyState = 'closed'
                clientDcs[0]!.onclose?.()
              }
              sendFromHostOnDc(idx, createRpcResponse(req.id, { ok: true }))
            } else {
              sendFromHostOnDc(idx, createRpcResponse(req.id, { ok: true, echo: req.payload.params }))
            }
          },
          close: () => { if (dc.readyState !== 'closed') { dc.readyState = 'closed'; dc.onclose?.() } },
        }
        clientDcs.push(dc)
        const pc: RtcPeerConnection = {
          connectionState: 'new', iceConnectionState: 'new', iceGatheringState: 'new', signalingState: 'stable',
          onicecandidate: null, ondatachannel: null, onconnectionstatechange: null, oniceconnectionstatechange: null, onicegatheringstatechange: null,
          createDataChannel: () => dc,
          createOffer: async () => ({ type: 'offer', sdp: 'v=0\r\noffer' }),
          createAnswer: async () => ({ type: 'answer', sdp: 'v=0\r\nanswer' }),
          setLocalDescription: async () => undefined,
          setRemoteDescription: async () => {
            queueMicrotask(() => {
              pc.connectionState = 'connected'
              pc.iceConnectionState = 'connected'
              dc.readyState = 'open'
              dc.onopen?.()
            })
          },
          addIceCandidate: async () => undefined,
          getStats: async () => makeStats(tier),
          close: () => dc.close(),
        }
        return pc
      },
    }

    let closed = false
    const secure = new SecureTransport(
      inner,
      { deviceId: 'client-1', name: 'Phone', platform: 'android', publicKey: clientKeys.publicKey, privateKey: clientKeys.privateKey },
      { deviceId: 'host-1', name: 'Mac', platform: 'darwin', identityKey: hostKeys.publicKey, membershipId: 'm1', online: true, trusted: true },
    )
    const core = new RemoteClientCore(secure)
    core.onClose(() => { closed = true })
    await core.connect()

    const upgrader = new ClientLiveTransportUpgrader({
      connectionId: 'conn-android-upg',
      rpc: core,
      channel: secure,
      rtcFactory: factory,
    })

    expect(await upgrader.promote()).toBe(true)
    expect(secure.getStats().mode).toBe('P2P')

    tier = 'LAN'
    const p = upgrader.promote({ preferLan: true })
    await new Promise(resolve => setTimeout(resolve, 5))
    const inFlightRpc = core.rpc('harness.transport.describe', { during: 'activate' })
    const [ok, res] = await Promise.all([p, inFlightRpc])
    expect(ok).toBe(true)
    expect(res).toEqual({ ok: true, echo: { during: 'activate' } })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(drainWatermarks.length).toBe(2)
    expect(clientDcs[0]!.readyState).toBe('closed')
    expect(closed).toBe(false)
    expect(secure.getStats().mode).toBe('LAN')

    await upgrader.close()
    await core.close()
  })
})
