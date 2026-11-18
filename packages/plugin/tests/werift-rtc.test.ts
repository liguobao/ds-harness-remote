import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { NetworkInterfaceInfo } from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { RtcDataChannelTransport } from '@dsh-remote/webrtc'
import { describe, expect, it } from 'vitest'
import { buildExternalNativeRtcFactory, resolveNativeRtcRequireFrom } from '../src/native-rtc-helper.js'
import {
  buildWeriftFactory,
  detectHostIpv4Candidates,
  loadNodeRtcFactory,
  loadWeriftFactory,
  orderIceServersForWerift,
  shouldAdvertiseCandidate,
} from '../src/werift-rtc.js'

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
const require = createRequire(import.meta.url)

async function waitFor(condition: () => boolean, label: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`${label} timed out after ${timeoutMs}ms`)
    await sleep(20)
  }
}

class CapturingWeriftPeerConnection {
  static configs: unknown[] = []
  static instances: CapturingWeriftPeerConnection[] = []

  connectionState = 'new'
  iceConnectionState = 'new'
  iceGatheringState = 'new'
  signalingState = 'stable'
  onconnectionstatechange: (() => void) | null = null
  oniceconnectionstatechange: (() => void) | null = null
  onicegatheringstatechange: (() => void) | null = null
  onicecandidate: ((event: { candidate?: { toJSON(): unknown } }) => void) | null = null
  ondatachannel: ((event: { channel: unknown }) => void) | null = null

  constructor(config?: unknown) {
    CapturingWeriftPeerConnection.configs.push(config)
    CapturingWeriftPeerConnection.instances.push(this)
  }

  createDataChannel(): never { throw new Error('not used') }
  async createOffer(): Promise<{ type: 'offer'; sdp: string }> { return { type: 'offer', sdp: 'v=0' } }
  async createAnswer(): Promise<{ type: 'answer'; sdp: string }> { return { type: 'answer', sdp: 'v=0' } }
  async setLocalDescription(): Promise<void> {}
  async setRemoteDescription(): Promise<void> {}
  async addIceCandidate(): Promise<void> {}
  async getStats(): Promise<[]> { return [] }
  async close(): Promise<void> {}
}

describe('werift RTC backend', () => {
  it('resolves native dependencies from a symlinked plugin physical path', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-remote-rtc-'))
    try {
      const physical = join(directory, 'physical')
      const surfaced = join(directory, 'surfaced')
      const entry = join(physical, 'dist', 'index.js')
      mkdirSync(join(physical, 'dist'), { recursive: true })
      writeFileSync(entry, '')
      symlinkSync(physical, surfaced, process.platform === 'win32' ? 'junction' : 'dir')

      expect(resolveNativeRtcRequireFrom(pathToFileURL(join(surfaced, 'dist', 'index.js')).href))
        .toBe(realpathSync(entry))
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('keeps physical IPv4 candidates instead of pinning to a single enumerated address', () => {
    expect(detectHostIpv4Candidates({
      bridge0: [ipv4('192.168.64.1')],
      utun4: [ipv4('10.251.1.1')],
      utun5: [ipv4('100.64.0.8')],
      en7: [ipv4('192.168.50.10')],
    })).toEqual(['192.168.50.10'])

    expect(detectHostIpv4Candidates({
      en7: [ipv4('192.168.50.10')],
      en0: [ipv4('192.168.75.58')],
      eth0: [ipv4('10.0.0.7')],
    })).toEqual(['10.0.0.7', '192.168.75.58', '192.168.50.10'])

    expect(detectHostIpv4Candidates({
      en7: [ipv4('192.168.50.10')],
      en0: [ipv4('192.168.75.58')],
      eth0: [ipv4('10.0.0.7')],
    }, ['192.168.50.10'])).toEqual(['192.168.50.10', '10.0.0.7', '192.168.75.58'])
  })

  it('filters virtual Host candidates while preserving TURN fallback candidates', () => {
    const allowed = new Set(['192.168.50.10'])

    expect(shouldAdvertiseCandidate({
      candidate: 'candidate:1 1 udp 2130706431 192.168.50.10 5000 typ host generation 0',
    }, allowed)).toBe(true)
    expect(shouldAdvertiseCandidate({
      candidate: 'candidate:2 1 udp 2130706431 192.168.64.1 5001 typ host generation 0',
    }, allowed)).toBe(false)
    expect(shouldAdvertiseCandidate({
      candidate: 'candidate:3 1 udp 1694498815 203.0.113.8 5002 typ srflx raddr 192.168.50.10 rport 5000',
    }, allowed)).toBe(true)
    expect(shouldAdvertiseCandidate({
      candidate: 'candidate:4 1 udp 1694498815 203.0.113.9 5003 typ srflx raddr 192.168.64.1 rport 5001',
    }, allowed)).toBe(false)
    expect(shouldAdvertiseCandidate({
      candidate: 'candidate:5 1 udp 16777215 198.51.100.5 5004 typ relay raddr 0.0.0.0 rport 0',
    }, allowed)).toBe(true)
  })

  it('orders TURN urls for werift so TCP/TLS is not hidden behind UDP', () => {
    expect(orderIceServersForWerift([{
      urls: [
        'turn:turn.example.test:3479?transport=udp',
        'turns:turn.example.test:5349?transport=tcp',
        'stun:turn.example.test:3479',
        'turn:turn.example.test:3479?transport=tcp',
      ],
      username: 'user',
      credential: 'secret',
    }])).toEqual([{
      urls: [
        'stun:turn.example.test:3479',
        'turn:turn.example.test:3479?transport=tcp',
        'turns:turn.example.test:5349?transport=tcp',
        'turn:turn.example.test:3479?transport=udp',
      ],
      username: 'user',
      credential: 'secret',
    }])
  })

  it('configures werift to let real interfaces race while blocking bad host pairs', () => {
    CapturingWeriftPeerConnection.configs = []
    CapturingWeriftPeerConnection.instances = []
    const diagnostics: unknown[] = []
    const factory = buildWeriftFactory({
      RTCPeerConnection: CapturingWeriftPeerConnection,
    }, {
      interfaces: {
        bridge0: [ipv4('192.168.64.1')],
        en7: [ipv4('192.168.50.10')],
      },
    })

    const pc = factory.create({
      iceServers: [{ urls: 'stun:stun.example.test:3478' }],
      onDiagnostic: event => diagnostics.push(event),
    })
    const config = CapturingWeriftPeerConnection.configs[0] as {
      iceAdditionalHostAddresses?: string[]
      iceFilterCandidatePair?: (pair: { localCandidate?: { type?: string; host?: string; relatedAddress?: string } }) => boolean
      iceInterfaceAddresses?: { udp4?: string }
      iceUseIpv4?: boolean
      iceUseIpv6?: boolean
      iceUseLinkLocalAddress?: boolean
    }

    expect(config.iceUseIpv4).toBe(true)
    expect(config.iceUseIpv6).toBe(false)
    expect(config.iceUseLinkLocalAddress).toBe(false)
    expect(config.iceInterfaceAddresses).toBeUndefined()
    expect(config.iceAdditionalHostAddresses).toEqual(['192.168.50.10'])
    expect(config.iceFilterCandidatePair?.({ localCandidate: { type: 'host', host: '192.168.50.10' } })).toBe(true)
    expect(config.iceFilterCandidatePair?.({ localCandidate: { type: 'host', host: '192.168.64.1' } })).toBe(false)
    expect(config.iceFilterCandidatePair?.({ localCandidate: { type: 'relay', host: '198.51.100.5' } })).toBe(true)

    pc.onicecandidate = () => undefined
    CapturingWeriftPeerConnection.instances[0]!.onicecandidate?.({
      candidate: { toJSON: () => ({ candidate: 'candidate:2 1 udp 2130706431 192.168.64.1 5001 typ host generation 0' }) },
    })
    expect(diagnostics).toContainEqual({
      type: 'candidate-pair-filtered',
      localCandidate: {
        candidateType: 'host',
        addressFamily: 'ipv4',
        addressScope: 'private',
      },
      reason: 'local-host-not-allowed',
    })
    expect(diagnostics).toContainEqual({
      type: 'local-candidate-filtered',
      candidate: {
        candidateType: 'host',
        protocol: 'udp',
        addressFamily: 'ipv4',
        addressScope: 'private',
      },
      reason: 'local-host-not-allowed',
    })
  })

  it('loads and establishes an ordered DataChannel through the adapter', async () => {
    const factory = await loadWeriftFactory()
    expect(factory).toBeDefined()

    const initiatorReceived: Uint8Array[] = []
    const responderReceived: Uint8Array[] = []

    const initiator = new RtcDataChannelTransport({
      role: 'initiator',
      factory: factory!,
      onSignal: signal => responder.handleSignal(signal),
      negotiateTimeoutMs: 8_000,
    })
    const responder = new RtcDataChannelTransport({
      role: 'responder',
      factory: factory!,
      onSignal: signal => initiator.handleSignal(signal),
      negotiateTimeoutMs: 8_000,
    })
    initiator.onMessage(data => initiatorReceived.push(data))
    responder.onMessage(data => responderReceived.push(data))

    await Promise.all([initiator.connect(), responder.connect()])
    await initiator.send(new TextEncoder().encode('hello-from-adapter'))
    await waitFor(() => responderReceived.length === 1, 'responder receive')
    await responder.send(new TextEncoder().encode('reply'))
    await waitFor(() => initiatorReceived.length === 1, 'initiator receive')

    expect(new TextDecoder().decode(responderReceived[0]!)).toBe('hello-from-adapter')
    expect(new TextDecoder().decode(initiatorReceived[0]!)).toBe('reply')
    expect(['lan', 'p2p']).toContain(initiator.selectedTransport() ?? responder.selectedTransport())

    await initiator.close()
    await responder.close()
    expect(initiator.getStats().connected).toBe(false)
    expect(responder.getStats().connected).toBe(false)
  }, 20_000)

  it('loads the default Node RTC backend and establishes an ordered DataChannel', async () => {
    const factory = await loadNodeRtcFactory()
    expect(factory).toBeDefined()

    const received: Uint8Array[] = []
    const initiator = new RtcDataChannelTransport({
      role: 'initiator',
      factory: factory!,
      onSignal: signal => responder.handleSignal(signal),
      negotiateTimeoutMs: 8_000,
    })
    const responder = new RtcDataChannelTransport({
      role: 'responder',
      factory: factory!,
      onSignal: signal => initiator.handleSignal(signal),
      negotiateTimeoutMs: 8_000,
    })
    responder.onMessage(data => received.push(data))

    await Promise.all([initiator.connect(), responder.connect()])
    await initiator.send(new TextEncoder().encode('hello-from-node-default'))
    await waitFor(() => received.length === 1, 'node default receive')

    expect(new TextDecoder().decode(received[0]!)).toBe('hello-from-node-default')
    expect(initiator.selectedTransport() ?? responder.selectedTransport()).toBe('lan')

    await initiator.close()
    await responder.close()
  }, 20_000)

  it('establishes an ordered DataChannel through the isolated native helper when available', async () => {
    if (!hasNativeRtc()) {
      expect(true).toBe(true)
      return
    }
    const factory = buildExternalNativeRtcFactory(process.execPath)

    const received: Uint8Array[] = []
    const initiator = new RtcDataChannelTransport({
      role: 'initiator',
      factory,
      onSignal: signal => responder.handleSignal(signal),
      negotiateTimeoutMs: 8_000,
    })
    const responder = new RtcDataChannelTransport({
      role: 'responder',
      factory,
      onSignal: signal => initiator.handleSignal(signal),
      negotiateTimeoutMs: 8_000,
    })
    responder.onMessage(data => received.push(data))

    await Promise.all([initiator.connect(), responder.connect()])
    await initiator.send(new TextEncoder().encode('hello-from-helper'))
    await waitFor(() => received.length === 1, 'helper receive')

    expect(new TextDecoder().decode(received[0]!)).toBe('hello-from-helper')
    expect(initiator.selectedTransport() ?? responder.selectedTransport()).toBe('lan')

    await initiator.close()
    await responder.close()
  }, 20_000)

  it('delivers many concurrent ordered frames without loss or reordering', async () => {
    const factory = await loadWeriftFactory()
    expect(factory).toBeDefined()

    const received: string[] = []
    const initiator = new RtcDataChannelTransport({
      role: 'initiator',
      factory: factory!,
      onSignal: signal => responder.handleSignal(signal),
      negotiateTimeoutMs: 8_000,
    })
    const responder = new RtcDataChannelTransport({
      role: 'responder',
      factory: factory!,
      onSignal: signal => initiator.handleSignal(signal),
      negotiateTimeoutMs: 8_000,
    })
    responder.onMessage(data => received.push(new TextDecoder().decode(data)))

    await Promise.all([initiator.connect(), responder.connect()])
    // Fire many sends without awaiting each, exercising the send-chain path.
    const pending = Array.from({ length: 60 }, (_, index) =>
      initiator.send(new TextEncoder().encode(`frame-${index}`)))
    await Promise.all(pending)
    await waitFor(() => received.length === 60, 'all frames received', 15_000)

    expect(received).toEqual(Array.from({ length: 60 }, (_, index) => `frame-${index}`))
    await initiator.close()
    await responder.close()
  }, 30_000)
})

function hasNativeRtc(): boolean {
  try {
    require('@roamhq/wrtc')
    return true
  } catch {
    return false
  }
}

function ipv4(address: string): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal: false,
    cidr: `${address}/24`,
  }
}
