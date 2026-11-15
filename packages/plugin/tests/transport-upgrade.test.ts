import { describe, expect, it, vi } from 'vitest'
import { generateKeyPair, NoiseIkSession, createNoisePrologue } from '@dsh-remote/crypto'
import {
  SequencedCiphertextReorderBuffer,
  createRpcRequest,
  createRpcResponse,
  type RemoteMessage,
} from '@dsh-remote/protocol'
import { ClientLiveTransportUpgrader, RemoteClientCore, type UpgradeableSecureChannel } from '@dsh-remote/client-core'
import {
  isSequencedOutboundTransport,
  type RtcDataChannel,
  type RtcPeerConnection,
  type RtcPeerConnectionFactory,
  type RtcStats,
  type SequencedOutboundTransport,
} from '@dsh-remote/webrtc'
import { ServerNoiseChannel } from '../src/server-connection.js'
import { TransportUpgradeHost, wrapUpgradedTransportFrame, type TransportTier } from '../src/transport-upgrade.js'

function makeStats(tier: 'LAN' | 'P2P' | 'TURN' | 'unverified'): RtcStats {
  if (tier === 'unverified') return new Map()
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

function createPairedRtcFactories(hostTier: () => 'LAN' | 'P2P' | 'TURN' | 'unverified', clientTier?: () => 'LAN' | 'P2P' | 'TURN' | 'unverified') {
  const pairs: Array<{ clientDc?: RtcDataChannel; hostDc?: RtcDataChannel; hostPcClosed: boolean; clientPcClosed: boolean; closeHostDc: () => void }> = []
  let pendingPair: typeof pairs[number] | undefined

  const clientFactory: RtcPeerConnectionFactory = {
    create() {
      const pair: typeof pairs[number] = { hostPcClosed: false, clientPcClosed: false, closeHostDc: () => undefined }
      pairs.push(pair)
      pendingPair = pair
      const dc: RtcDataChannel = {
        label: 'dsh', ordered: true, readyState: 'connecting', bufferedAmount: 0, binaryType: 'arraybuffer',
        onopen: null, onmessage: null, onclose: null, onerror: null, onbufferedamountlow: null,
        send: data => {
          if (pair.hostDc && pair.hostDc.readyState === 'open') {
            pair.hostDc.onmessage?.({ data })
          }
        },
        close: () => { dc.readyState = 'closed'; dc.onclose?.() },
      }
      pair.clientDc = dc
      const pc: RtcPeerConnection = {
        connectionState: 'new', iceConnectionState: 'new', iceGatheringState: 'new', signalingState: 'stable',
        onicecandidate: null, ondatachannel: null, onconnectionstatechange: null, oniceconnectionstatechange: null, onicegatheringstatechange: null,
        createDataChannel: () => dc,
        createOffer: async () => ({ type: 'offer', sdp: 'v=0\r\noffer' }),
        createAnswer: async () => ({ type: 'answer', sdp: 'v=0\r\nanswer' }),
        setLocalDescription: async () => {
          pc.onicecandidate?.({ candidate: { candidate: 'candidate:1 1 udp 1 192.168.1.10 5000 typ host', sdpMid: '0' } })
        },
        setRemoteDescription: async () => {
          queueMicrotask(() => {
            if (pair.clientPcClosed || pair.hostPcClosed) return
            dc.readyState = 'open'
            dc.onopen?.()
            if (pair.hostDc) {
              pair.hostDc.readyState = 'open'
              pair.hostDc.onopen?.()
            }
          })
        },
        addIceCandidate: async () => undefined,
        getStats: async () => makeStats((clientTier ?? hostTier)()),
        close: () => { pair.clientPcClosed = true; dc.readyState = 'closed' },
      }
      return pc
    },
  }

  const hostFactory: RtcPeerConnectionFactory = {
    create() {
      const pair: typeof pairs[number] = pendingPair ?? { hostPcClosed: false, clientPcClosed: false, closeHostDc: () => undefined }
      const dc: RtcDataChannel = {
        label: 'dsh', ordered: true, readyState: 'connecting', bufferedAmount: 0, binaryType: 'arraybuffer',
        onopen: null, onmessage: null, onclose: null, onerror: null, onbufferedamountlow: null,
        send: data => {
          if (pair.clientDc && pair.clientDc.readyState === 'open') {
            pair.clientDc.onmessage?.({ data })
          }
        },
        close: () => { dc.readyState = 'closed'; dc.onclose?.() },
      }
      pair.hostDc = dc
      pair.closeHostDc = () => { dc.readyState = 'closed'; dc.onclose?.(); pair.clientDc?.onclose?.() }
      const pc: RtcPeerConnection = {
        connectionState: 'new', iceConnectionState: 'new', iceGatheringState: 'new', signalingState: 'stable',
        onicecandidate: null, ondatachannel: null, onconnectionstatechange: null, oniceconnectionstatechange: null, onicegatheringstatechange: null,
        createDataChannel: () => dc,
        createOffer: async () => ({ type: 'offer', sdp: 'v=0\r\noffer' }),
        createAnswer: async () => ({ type: 'answer', sdp: 'v=0\r\nanswer' }),
        setLocalDescription: async () => {
          pc.onicecandidate?.({ candidate: { candidate: 'candidate:2 1 udp 1 192.168.1.20 5000 typ host', sdpMid: '0' } })
          pc.ondatachannel?.({ channel: dc })
        },
        setRemoteDescription: async () => undefined,
        addIceCandidate: async () => undefined,
        getStats: async () => makeStats(hostTier()),
        close: () => { pair.hostPcClosed = true; dc.readyState = 'closed' },
      }
      return pc
    },
  }

  return { clientFactory, hostFactory, pairs }
}

describe('In-band Transport Upgrade & Reorder / Drain Boundaries', () => {
  it('strictly trusts Host ICE stats over inflated Client transport claims and rejects unverified paths', async () => {
    let mode: TransportTier = 'Relay'
    let hostObserved: 'LAN' | 'P2P' | 'TURN' | 'unverified' = 'TURN'
    const { clientFactory, hostFactory } = createPairedRtcFactories(() => hostObserved, () => 'LAN')

    const host = new TransportUpgradeHost({
      connectionId: 'conn-strict',
      peerDeviceId: 'peer-1',
      currentMode: () => mode,
      outboundCounter: () => 0,
      loadRtcFactory: async () => hostFactory,
      fetchIceServers: async () => [],
      onReceiveSequencedCiphertext: () => undefined,
      adoptRtc: async (_rtc, verified) => { mode = verified; return 0 },
      publishEvent: async () => undefined,
    })

    // Client creates PC first (just like real initiator), claims 'lan', while Host ICE stats observe 'TURN'
    const clientPc = clientFactory.create({})
    clientPc.createDataChannel('dsh')
    const ans = await host.offer({ attemptId: 'a1', sdp: 'v=0\r\noffer' })
    await clientPc.setRemoteDescription({ type: 'answer', sdp: ans.sdp })
    const res = await host.activate({ attemptId: 'a1', transport: 'lan', previousLegEndCounter: 0 })
    expect(res.activated).toBe(true)
    expect(res.mode).toBe('TURN')
    expect(mode).toBe('TURN')

    // Unverified stats on Host -> rejected cleanly without elevating tier
    hostObserved = 'unverified'
    const clientPc2 = clientFactory.create({})
    clientPc2.createDataChannel('dsh')
    const ans2 = await host.offer({ attemptId: 'a2', sdp: 'v=0\r\noffer2' })
    await clientPc2.setRemoteDescription({ type: 'answer', sdp: ans2.sdp })
    const res2 = await host.activate({ attemptId: 'a2', transport: 'lan' })
    expect(res2.activated).toBe(false)
    expect(mode).toBe('TURN')

    await host.closeAll()
  })

  it('enforces reorder buffer frame limit, total byte budget, and gap timeout', async () => {
    vi.useFakeTimers()
    try {
      let timedOutAt: number | undefined
      const buf = new SequencedCiphertextReorderBuffer({
        maxFrames: 3,
        maxBytes: 100,
        gapTimeoutMs: 500,
        onGapTimeout: missing => { timedOutAt = missing },
      })

      buf.push(1, 0, new Uint8Array(40))
      buf.push(2, 0, new Uint8Array(40))
      // Exceeding maxBytes (40 + 40 + 30 > 100) throws immediately
      expect(() => buf.push(3, 0, new Uint8Array(30))).toThrow(/exceeded its limit/)
      // Duplicate buffered counter throws
      expect(() => buf.push(1, 0, new Uint8Array(10))).toThrow(/Duplicate/)

      // Gap timeout fires after 500ms if counter 0 never arrives
      vi.advanceTimersByTime(499)
      expect(timedOutAt).toBeUndefined()
      vi.advanceTimersByTime(2)
      expect(timedOutAt).toBe(0)
      buf.clear()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reassembles out-of-order frames when fast upgraded WebRTC frames overtake trailing Relay frames and drains old WebRTC leg by counter watermark', async () => {
    const hostKeys = generateKeyPair()
    const clientKeys = generateKeyPair()
    const connectionId = 'conn-reorder-1'
    const prologue = createNoisePrologue(connectionId, 'host-1', 'client-1')
    const clientNoise = new NoiseIkSession({
      role: 'initiator',
      localPrivateKey: clientKeys.privateKey,
      localPublicKey: clientKeys.publicKey,
      remotePublicKey: hostKeys.publicKey,
      prologue,
    })
    const hostNoise = new NoiseIkSession({
      role: 'responder',
      localPrivateKey: hostKeys.privateKey,
      localPublicKey: hostKeys.publicKey,
      remotePublicKey: clientKeys.publicKey,
      prologue,
    })
    hostNoise.readHandshake(clientNoise.writeHandshake())
    clientNoise.readHandshake(hostNoise.writeHandshake())

    const relaySentByHost: Uint8Array[] = []
    const hostReceived: RemoteMessage[] = []
    let channelClosed = false
    const serverChannel = new ServerNoiseChannel(
      {
        connectionId,
        membershipId: 'mem-1',
        peer: { deviceId: 'client-1', name: 'Client', platform: 'android', publicKey: clientKeys.publicKey, membershipId: 'mem-1', trustedAt: '2026-01-01T00:00:00Z' },
        preferredTransports: ['lan', 'p2p', 'relay'],
        noise: hostNoise,
        transport: 'relay',
      } as never,
      async cipher => { relaySentByHost.push(cipher) },
      async () => { channelClosed = true },
      'Relay',
    )
    serverChannel.onMessage(msg => hostReceived.push(msg))

    // Client encrypts 3 messages: counter 0 (delayed on Relay), counter 1 & 2 (fast on upgraded P2P)
    const encodeClientMsg = (id: string) => {
      const req = createRpcRequest('harness.transport.describe', {})
      req.id = id
      return clientNoise.encrypt(new TextEncoder().encode(JSON.stringify(req)))
    }
    const c0 = encodeClientMsg('m0')
    const c1 = encodeClientMsg('m1')
    const c2 = encodeClientMsg('m2')

    // Fast P2P frames c2 and c1 arrive BEFORE trailing Relay frame c0!
    serverChannel.receive(2, c2)
    serverChannel.receive(1, c1)
    expect(hostReceived).toHaveLength(0)

    // Trailing Relay frame c0 arrives -> all 3 decrypt strictly in order (m0, m1, m2)!
    serverChannel.receive(0, c0)
    expect(channelClosed).toBe(false)
    expect(hostReceived.map(m => m.id)).toEqual(['m0', 'm1', 'm2'])

    // Two-phase watermark draining of old WebRTC leg on P2P -> LAN switch:
    let oldP2pDisposed = false
    const fakeOldRtc = {} as never
    const c3 = encodeClientMsg('m3') // counter 3 still in flight on old P2P leg
    const c4 = encodeClientMsg('m4') // counter 4 sent on new LAN leg
    await serverChannel.upgradeTransport('LAN', async () => undefined, fakeOldRtc, 'att-lan', () => { oldP2pDisposed = true })
    // Never closed immediately during activate before Client switches outbound!
    expect(oldP2pDisposed).toBe(false)

    // Client confirms drain watermark = 4 over new LAN leg, and c4 arrives on LAN before trailing c3:
    serverChannel.confirmPreviousLegDrain('att-lan', 4)
    serverChannel.receive(4, c4)
    expect(oldP2pDisposed).toBe(false)

    // Trailing c3 arrives from old P2P leg -> receivingCounter reaches 5 >= 4, old P2P leg disposes immediately!
    serverChannel.receive(3, c3)
    expect(oldP2pDisposed).toBe(true)
    expect(hostReceived.map(m => m.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
  })

  it('runs end-to-end ClientLiveTransportUpgrader + TransportUpgradeHost across Relay -> P2P -> LAN, concurrent supersede, abort race, and post-upgrade drop', async () => {
    let currentNetTier: 'LAN' | 'P2P' | 'TURN' = 'P2P'
    const { clientFactory, hostFactory, pairs } = createPairedRtcFactories(() => currentNetTier)

    let hostMode: TransportTier = 'Relay'
    let hostClosed = false
    let clientClosed = false
    let clientOutboundCounter = 0
    let hostOutboundCounter = 0
    let relaySentBytes = 120
    let relayReceivedBytes = 340
    let clientMsgHandler: ((data: Uint8Array) => void) | undefined
    let hostUpgrade!: TransportUpgradeHost

    const channel: UpgradeableSecureChannel = {
      get outboundCounter() { return clientOutboundCounter },
      attachIncomingLeg: () => undefined,
      switchOutboundLeg: async () => clientOutboundCounter,
      detachLeg: async leg => { await leg.close() },
      relayTrafficBytes: () => ({ sent: relaySentBytes, received: relayReceivedBytes }),
    }

    // In-memory RPC bridge between RemoteClientCore and TransportUpgradeHost
    const clientTransport = {
      connect: async () => undefined,
      send: async (bytes: Uint8Array) => {
        clientOutboundCounter += 1
        const msg = JSON.parse(new TextDecoder().decode(bytes)) as RemoteMessage<{ method: string; params: unknown }>
        if (msg.type === 'rpc.request') {
          let result: unknown
          switch (msg.payload.method) {
            case 'remote.transport.upgrade.offer': result = await hostUpgrade.offer(msg.payload.params); break
            case 'remote.transport.upgrade.ice': result = await hostUpgrade.addIce(msg.payload.params); break
            case 'remote.transport.upgrade.activate': result = await hostUpgrade.activate(msg.payload.params); break
            case 'remote.transport.upgrade.drain': result = await hostUpgrade.drain(msg.payload.params); break
            case 'remote.transport.upgrade.abort': result = await hostUpgrade.abort(msg.payload.params); break
          }
          const resp = createRpcResponse(msg.id, result)
          hostOutboundCounter += 1
          clientMsgHandler?.(new TextEncoder().encode(JSON.stringify(resp)))
        }
      },
      onMessage: (cb: (data: Uint8Array) => void) => { clientMsgHandler = cb; return () => { clientMsgHandler = undefined } },
      onClose: () => () => undefined,
      close: async () => { clientClosed = true },
      getStats: () => ({ mode: hostMode, connected: !clientClosed, bytesSent: 0, bytesReceived: 0 }),
    }

    const clientCore = new RemoteClientCore(clientTransport)
    await clientCore.connect()

    hostUpgrade = new TransportUpgradeHost({
      connectionId: 'conn-e2e',
      peerDeviceId: 'client-1',
      currentMode: () => hostMode,
      outboundCounter: () => hostOutboundCounter,
      loadRtcFactory: async () => hostFactory,
      fetchIceServers: async () => [],
      onReceiveSequencedCiphertext: () => undefined,
      adoptRtc: async (rtc, nextMode) => {
        hostMode = nextMode
        rtc.onClose(() => { hostClosed = true })
        return hostOutboundCounter
      },
      publishEvent: async evt => {
        clientMsgHandler?.(new TextEncoder().encode(JSON.stringify(evt)))
      },
    })

    const telemetries: unknown[] = []
    const upgrader = new ClientLiveTransportUpgrader({
      connectionId: 'conn-e2e',
      rpc: clientCore,
      channel,
      rtcFactory: clientFactory,
      onTelemetry: t => telemetries.push(t),
    })

    // 1. Climb Relay -> P2P via waitForInitialWindow
    const fastReady = await upgrader.waitForInitialWindow(500)
    expect(fastReady).toBe(true)
    expect(upgrader.currentMode).toBe('P2P')
    expect(hostMode).toBe('P2P')

    // 2. Same-tier P2P attempt is skipped cleanly without interrupting active P2P
    const skipped = await upgrader.promote()
    expect(skipped).toBe(false)
    expect(upgrader.currentMode).toBe('P2P')
    expect(hostClosed).toBe(false)

    // 3. Climb P2P -> LAN when moving onto Wi-Fi
    currentNetTier = 'LAN'
    const climbedLan = await upgrader.promote({ preferLan: true })
    expect(climbedLan).toBe(true)
    expect(upgrader.currentMode).toBe('LAN')
    expect(hostMode).toBe('LAN')
    expect(telemetries.length).toBe(3)

    // 4. Post-upgrade DataChannel drop triggers tunnel close (never silently pretends to fall back to Relay)
    pairs[pairs.length - 1]!.closeHostDc()
    expect(hostClosed).toBe(true)

    await upgrader.close()
    await hostUpgrade.closeAll()
    await clientCore.close()
  })

  it('keeps existing Relay channel intact when pre-activation offer/abort/close fails or races', async () => {
    let mode: TransportTier = 'Relay'
    const { hostFactory } = createPairedRtcFactories(() => 'P2P')
    const host = new TransportUpgradeHost({
      connectionId: 'conn-race',
      peerDeviceId: 'peer-1',
      currentMode: () => mode,
      outboundCounter: () => 0,
      loadRtcFactory: async () => hostFactory,
      fetchIceServers: async () => [],
      onReceiveSequencedCiphertext: () => undefined,
      adoptRtc: async (_rtc, next) => { mode = next; return 0 },
      publishEvent: async () => undefined,
    })

    // Duplicate / concurrent offer supersedes the older attempt cleanly
    await host.offer({ attemptId: 'old', sdp: 'v=0\r\noffer1' })
    await host.offer({ attemptId: 'new', sdp: 'v=0\r\noffer2' })
    await expect(host.activate({ attemptId: 'old' })).rejects.toThrow(/no longer active/)

    // Abort before activate rejects subsequent activate while keeping Relay intact
    await host.abort({ attemptId: 'new' })
    await expect(host.activate({ attemptId: 'new' })).rejects.toThrow(/no longer active/)
    expect(mode).toBe('Relay')

    await host.closeAll()
  })
})
