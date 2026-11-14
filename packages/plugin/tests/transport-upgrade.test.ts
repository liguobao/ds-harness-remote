import { describe, expect, it, vi } from 'vitest'
import type { RtcDataChannel, RtcPeerConnection, RtcPeerConnectionFactory } from '@dsh-remote/webrtc'
import { TransportUpgradeHost, type TransportTier } from '../src/transport-upgrade.js'

function createFakeRtcFactory(selectedLocalScope: 'private' | 'public' = 'private'): {
  factory: RtcPeerConnectionFactory
  openChannel: () => void
} {
  let channelHolder: RtcDataChannel | undefined
  let pcRef: RtcPeerConnection | undefined
  const factory: RtcPeerConnectionFactory = {
    create() {
      const channel: RtcDataChannel = {
        label: 'dsh',
        ordered: true,
        readyState: 'connecting',
        bufferedAmount: 0,
        binaryType: 'arraybuffer',
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        onbufferedamountlow: null,
        send: vi.fn(),
        close: vi.fn(() => { channel.readyState = 'closed'; channel.onclose?.() }),
      }
      channelHolder = channel
      const pc: RtcPeerConnection = {
        connectionState: 'new',
        iceConnectionState: 'new',
        iceGatheringState: 'new',
        signalingState: 'stable',
        onicecandidate: null,
        ondatachannel: null,
        onconnectionstatechange: null,
        oniceconnectionstatechange: null,
        onicegatheringstatechange: null,

        createDataChannel: () => channel,
        createOffer: async () => ({ type: 'offer', sdp: 'v=0\r\noffer' }),
        createAnswer: async () => ({ type: 'answer', sdp: 'v=0\r\nanswer' }),
        setLocalDescription: async () => {
          pc.onicecandidate?.({ candidate: { candidate: 'candidate:1 1 udp 1 192.168.1.2 5000 typ host', sdpMid: '0' } })
        },
        setRemoteDescription: async () => undefined,
        addIceCandidate: async () => undefined,
        getStats: async () => new Map([
          ['L1', { id: 'L1', type: 'local-candidate', candidateType: selectedLocalScope === 'private' ? 'host' : 'srflx', address: selectedLocalScope === 'private' ? '192.168.1.2' : '203.0.113.2' }],
          ['R1', { id: 'R1', type: 'remote-candidate', candidateType: selectedLocalScope === 'private' ? 'host' : 'srflx', address: selectedLocalScope === 'private' ? '192.168.1.3' : '198.51.100.3' }],
          ['P1', { id: 'P1', type: 'candidate-pair', localCandidateId: 'L1', remoteCandidateId: 'R1', state: 'succeeded', nominated: true }],
          ['T1', { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' }],
        ]),
        close: vi.fn(),
      }
      pcRef = pc
      return pc
    },
  }
  return {
    factory,
    openChannel() {
      if (!pcRef || !channelHolder) return
      pcRef.ondatachannel?.({ channel: channelHolder })
      channelHolder.readyState = 'open'
      channelHolder.onopen?.()
    },
  }
}

describe('TransportUpgradeHost', () => {
  it('promotes monotonically Relay -> P2P -> LAN and refuses same/lower-tier downgrades', async () => {
    let mode: TransportTier = 'Relay'
    const published: unknown[] = []
    let currentMock = createFakeRtcFactory('public')

    const host = new TransportUpgradeHost({
      connectionId: 'conn-1',
      peerDeviceId: 'peer-1',
      currentMode: () => mode,
      loadRtcFactory: async () => currentMock.factory,
      fetchIceServers: async () => [],
      onReceiveCiphertext: () => undefined,
      adoptRtc: async (_rtc, nextMode) => { mode = nextMode },
      publishEvent: async msg => { published.push(msg) },
    })

    // 1. Climb Relay -> P2P
    const offer1 = await host.offer({ attemptId: 'a1', sdp: 'v=0\r\noffer1' })
    expect(offer1.sdp).toContain('answer')
    expect(published.length).toBeGreaterThan(0)
    currentMock.openChannel()
    const act1 = await host.activate({ attemptId: 'a1', transport: 'p2p' })
    expect(act1).toEqual({ activated: true, mode: 'P2P' })
    expect(mode).toBe('P2P')

    // 2. Refuse P2P -> TURN downgrade
    currentMock = createFakeRtcFactory('public')
    await host.offer({ attemptId: 'a2', sdp: 'v=0\r\noffer2' })
    currentMock.openChannel()
    const act2 = await host.activate({ attemptId: 'a2', transport: 'p2p' })
    expect(act2).toEqual({ activated: false, mode: 'P2P' })

    // 3. Climb P2P -> LAN
    currentMock = createFakeRtcFactory('private')
    await host.offer({ attemptId: 'a3', sdp: 'v=0\r\noffer3' })
    currentMock.openChannel()
    const act3 = await host.activate({ attemptId: 'a3', transport: 'lan' })
    expect(act3).toEqual({ activated: true, mode: 'LAN' })
    expect(mode).toBe('LAN')

    await host.closeAll()
  })
})
