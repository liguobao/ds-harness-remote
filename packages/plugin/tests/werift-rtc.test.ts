import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { NetworkInterfaceInfo } from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  RtcDataChannelTransport,
  type RtcPeerConnection,
  type RtcPeerConnectionFactory,
  type RtcSessionDescriptionInit,
} from '@dsh-remote/webrtc'
import { describe, expect, it, vi } from 'vitest'
import { buildExternalNativeRtcFactory, resolveNativeRtcRequireFrom } from '../src/native-rtc-helper.js'
import {
  buildWeriftFactory,
  detectHostIpv4Candidates,
  loadNodeRtcFactory,
  loadWeriftFactory,
  orderIceServersForWerift,
  shouldAdvertiseCandidate,
  wrapLocalCandidateFilterFactory,
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

  it('ignores proxy TUN route preferences while retaining physical LAN candidates (#341)', () => {
    for (const name of ['FlClash', 'Mihomo', 'Clash', 'Meta', 'sing-box', 'tailscale0', 'zerotier', 'ztabcdef', 'wg0', 'wintun', 'ProtonVPN', 'Surge']) {
      expect(detectHostIpv4Candidates({
        [name]: [ipv4('10.99.0.1')],
        wlan0: [ipv4('192.168.31.238')],
      }, ['10.99.0.1'])).toEqual(['192.168.31.238'])
    }
    expect(detectHostIpv4Candidates({
      unknownProxy: [ipv4('198.18.0.1'), ipv4('198.19.255.254')],
      wlan0: [ipv4('192.168.31.238')],
    }, ['198.18.0.1'])).toEqual(['192.168.31.238'])
  })

  it('offers CGNAT IPv4 only on recognized Tailscale interfaces', () => {
    const scenarios = [
      { name: 'Linux Tailscale', interfaces: { tailscale0: [ipv4('100.64.0.8')] }, expected: ['100.64.0.8'] },
      { name: 'Windows Tailscale', interfaces: { Tailscale: [ipv4('100.64.0.8')] }, expected: ['100.64.0.8'] },
      {
        name: 'macOS Tailscale',
        interfaces: { utun5: [ipv4('100.64.0.8'), ipv4('10.0.0.1'), ipv6('fd7a:115c:a1e0::8')] },
        expected: ['100.64.0.8'],
      },
      {
        name: 'unrecognized tunnel and carrier CGNAT',
        interfaces: { utun5: [ipv4('100.64.0.8'), ipv6('fd00::8')], eth0: [ipv4('100.64.0.9')] },
        expected: [],
      },
    ]
    for (const { name, interfaces, expected } of scenarios) {
      expect(detectHostIpv4Candidates({ ...interfaces, en0: [ipv4('192.168.50.10')] }), name)
        .toEqual(['192.168.50.10', ...expected])
    }
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
        tailscale0: [ipv4('100.64.0.8')],
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
    expect(config.iceAdditionalHostAddresses).toEqual(['192.168.50.10', '100.64.0.8'])
    expect(config.iceFilterCandidatePair?.({ localCandidate: { type: 'host', host: '192.168.50.10' } })).toBe(true)
    expect(config.iceFilterCandidatePair?.({ localCandidate: { type: 'host', host: '100.64.0.8' } })).toBe(true)
    expect(config.iceFilterCandidatePair?.({ localCandidate: { type: 'host', host: '192.168.64.1' } })).toBe(false)
    expect(config.iceFilterCandidatePair?.({ localCandidate: { type: 'relay', host: '198.51.100.5' } })).toBe(true)

    const advertise = vi.fn()
    pc.onicecandidate = advertise
    const tailscaleCandidate = { candidate: 'candidate:1 1 udp 2130706431 100.64.0.8 5000 typ host generation 0' }
    CapturingWeriftPeerConnection.instances[0]!.onicecandidate?.({ candidate: { toJSON: () => tailscaleCandidate } })
    expect(advertise).toHaveBeenCalledWith({ candidate: tailscaleCandidate })
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

  it.each([
    { name: 'dual-stack Host', ipv4Available: true, globalIpv6Available: true },
    { name: 'IPv6-only Host', ipv4Available: false, globalIpv6Available: true },
    { name: 'Host without eligible IPv6', ipv4Available: true, globalIpv6Available: false },
  ])('filters candidate publication and pairing on a $name', ({ ipv4Available, globalIpv6Available }) => {
    const globalAddress = '240e:1234::1'
    const ipv4Address = '192.168.50.10'
    const factory = buildWeriftFactory({ RTCPeerConnection: CapturingWeriftPeerConnection }, {
      interfaces: {
        en0: [
          ...(ipv4Available ? [ipv4(ipv4Address)] : []),
          ...(globalIpv6Available ? [ipv6(globalAddress)] : []),
          ipv6('fe80::1'),
          ipv6('fd00::1'),
        ],
        utun0: [ipv6('240e:1234::2')],
      },
    })
    const pc = factory.create({})
    const config = CapturingWeriftPeerConnection.configs.at(-1) as {
      iceUseIpv6: boolean
      iceAdditionalHostAddresses: string[]
      iceFilterCandidatePair: (pair: { localCandidate: { type: string; host: string } }) => boolean
    }
    expect(config.iceUseIpv6).toBe(globalIpv6Available)
    expect(config.iceAdditionalHostAddresses).toEqual([
      ...(ipv4Available ? [ipv4Address] : []),
      ...(globalIpv6Available ? [globalAddress] : []),
    ])

    const advertise = vi.fn()
    pc.onicecandidate = advertise
    const raw = CapturingWeriftPeerConnection.instances.at(-1)!
    for (const { host, type, allowed } of [
      { host: ipv4Address, type: 'host', allowed: ipv4Available },
      { host: globalAddress, type: 'host', allowed: globalIpv6Available },
      { host: '240e:1234::2', type: 'host', allowed: false },
      { host: 'fe80::1', type: 'host', allowed: false },
      { host: 'fd00::1', type: 'host', allowed: false },
      { host: '198.51.100.5', type: 'relay', allowed: true },
    ]) {
      expect(config.iceFilterCandidatePair({ localCandidate: { type, host } }), host).toBe(allowed)
      const candidate = { candidate: `candidate:1 1 udp 2130706431 ${host} 5000 typ ${type}` }
      advertise.mockClear()
      raw.onicecandidate?.({ candidate: { toJSON: () => candidate } })
      expect(advertise.mock.calls, host).toEqual(allowed ? [[{ candidate }]] : [])
    }
  })

  it('filters proxy TUN and 198.18.0.0/15 host candidates from native SDP and trickle ICE (#341)', async () => {
    const candidateLines = [
      'candidate:1 1 udp 2130706431 198.18.0.1 5000 typ host generation 0',
      'candidate:2 1 udp 2130706431 198.19.255.254 5001 typ host generation 0',
      'candidate:3 1 udp 2130706431 ::ffff:198.18.0.2 5002 typ host generation 0',
      'candidate:4 1 udp 2130706431 10.99.0.1 5003 typ host generation 0',
      'candidate:5 1 udp 2130706431 fd00:99::1 5004 typ host generation 0',
      'candidate:6 1 udp 2130706431 10.251.1.1 5005 typ host generation 0',
      'candidate:7 1 udp 2130706431 192.168.31.238 5006 typ host generation 0',
      'candidate:8 1 udp 2130706431 10.0.0.7 5007 typ host generation 0',
      'candidate:9 1 udp 2130706431 100.64.0.8 5008 typ host generation 0',
      'candidate:10 1 udp 2130706431 100.64.0.9 5009 typ host generation 0',
      'candidate:11 1 udp 2130706431 203.0.113.10 5010 typ host generation 0',
      'candidate:12 1 udp 2130706431 240e:1234::1 5011 typ host generation 0',
      'candidate:13 1 udp 2130706431 a1b2c3d4-e5f6-7890-abcd-ef1234567890.local 5012 typ host generation 0',
      'candidate:14 1 udp 1694498815 203.0.113.8 5013 typ srflx raddr 198.18.0.1 rport 5000',
      'candidate:15 1 udp 16777215 198.51.100.5 5014 typ relay raddr 0.0.0.0 rport 0',
      'candidate:16 1 udp 1853824767 203.0.113.9 5015 typ prflx raddr 10.99.0.1 rport 5003',
    ]
    const expectedAllowed = candidateLines.slice(6)
    const buildSdp = (lines: string[]) => [
      'v=0',
      'o=- 1 2 IN IP4 127.0.0.1',
      's=-',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      ...lines.map(line => `a=${line}`),
      'a=end-of-candidates',
      '',
    ].join('\r\n')

    const offerSdp = buildSdp(candidateLines)
    const answerSdp = buildSdp(candidateLines)
    let rawInstance: (RtcPeerConnection & { localDescription?: RtcSessionDescriptionInit | null }) | undefined
    const rawFactory: RtcPeerConnectionFactory = {
      create() {
        const pc: RtcPeerConnection & { localDescription?: RtcSessionDescriptionInit | null } = {
          connectionState: 'new',
          iceConnectionState: 'new',
          iceGatheringState: 'new',
          signalingState: 'stable',
          localDescription: { type: 'offer', sdp: offerSdp },
          onconnectionstatechange: null,
          oniceconnectionstatechange: null,
          onicegatheringstatechange: null,
          onicecandidate: null,
          ondatachannel: null,
          createDataChannel() { throw new Error('not used') },
          async createOffer() { return { type: 'offer', sdp: offerSdp } },
          async createAnswer() { return { type: 'answer', sdp: answerSdp } },
          async setLocalDescription(description) { pc.localDescription = description ?? null },
          async setRemoteDescription() {},
          async addIceCandidate() {},
          async getStats() { return [] },
          close() {},
        }
        rawInstance = pc
        return pc
      },
    }

    const diagnostics: unknown[] = []
    const factory = wrapLocalCandidateFilterFactory(rawFactory, {
      interfaces: {
        Mihomo: [ipv4('10.99.0.1'), ipv4('198.18.0.1'), ipv6('fd00:99::1')],
        FlClash: [ipv4('198.18.0.2')],
        utun4: [ipv4('10.251.1.1')],
        utun5: [ipv4('100.64.0.8'), ipv6('fd7a:115c:a1e0::8')],
        tailscale0: [ipv4('100.64.0.9')],
        wlan0: [ipv4('192.168.31.238')],
        eth0: [ipv4('10.0.0.7'), ipv4('203.0.113.10'), ipv6('240e:1234::1')],
      },
    })

    const pc = factory.create({ onDiagnostic: event => diagnostics.push(event) }) as RtcPeerConnection & {
      localDescription?: RtcSessionDescriptionInit | null
    }

    const offer = await pc.createOffer()
    expect(offer.sdp).toBe(buildSdp(expectedAllowed))
    const answer = await pc.createAnswer()
    expect(answer.sdp).toBe(buildSdp(expectedAllowed))
    expect(pc.localDescription?.sdp).toBe(buildSdp(expectedAllowed))

    const advertise = vi.fn()
    pc.onicecandidate = advertise
    for (const line of candidateLines) {
      rawInstance!.onicecandidate?.({ candidate: { candidate: line, sdpMid: '0', sdpMLineIndex: 0 } })
    }
    rawInstance!.onicecandidate?.({ candidate: null })

    expect(advertise.mock.calls).toEqual([
      ...expectedAllowed.map(line => [{ candidate: { candidate: line, sdpMid: '0', sdpMLineIndex: 0 } }]),
      [{ candidate: null }],
    ])
    expect(diagnostics.filter(event => (event as { type?: string }).type === 'local-candidate-filtered')).toHaveLength(18)
    expect(diagnostics).toContainEqual({
      type: 'local-candidate-filtered',
      candidate: {
        candidateType: 'host',
        protocol: 'udp',
        addressFamily: 'ipv4',
        addressScope: 'public',
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

  it('records filtered local candidates when RtcDataChannelTransport uses wrapped native factory (#341)', async () => {
    let rawInstance: RtcPeerConnection | undefined
    const rawFactory: RtcPeerConnectionFactory = {
      create() {
        const pc: RtcPeerConnection = {
          connectionState: 'new',
          iceConnectionState: 'new',
          iceGatheringState: 'new',
          signalingState: 'stable',
          onconnectionstatechange: null,
          oniceconnectionstatechange: null,
          onicegatheringstatechange: null,
          onicecandidate: null,
          ondatachannel: null,
          createDataChannel(label, options) {
            return {
              label,
              ordered: options?.ordered ?? true,
              readyState: 'connecting',
              bufferedAmount: 0,
              binaryType: 'arraybuffer',
              onopen: null,
              onmessage: null,
              onclose: null,
              onerror: null,
              onbufferedamountlow: null,
              send() {},
              close() {},
            }
          },
          async createOffer() {
            return {
              type: 'offer',
              sdp: [
                'v=0',
                'a=candidate:1 1 udp 2130706431 198.18.0.1 5000 typ host',
                'a=candidate:2 1 udp 2130706431 192.168.31.238 5001 typ host',
                '',
              ].join('\r\n'),
            }
          },
          async createAnswer() { return { type: 'answer', sdp: 'v=0\r\n' } },
          async setLocalDescription() {},
          async setRemoteDescription() {},
          async addIceCandidate() {},
          async getStats() { return [] },
          close() {},
        }
        rawInstance = pc
        return pc
      },
    }

    const signals: unknown[] = []
    const transport = new RtcDataChannelTransport({
      role: 'initiator',
      factory: wrapLocalCandidateFilterFactory(rawFactory, {
        interfaces: {
          Clash: [ipv4('198.18.0.1')],
          wlan0: [ipv4('192.168.31.238')],
        },
      }),
      onSignal: signal => signals.push(signal),
      negotiateTimeoutMs: 5_000,
    })

    const connecting = transport.connect().catch(() => undefined)
    await waitFor(() => signals.length >= 1, 'filtered offer signal')
    rawInstance!.onicecandidate?.({
      candidate: { candidate: 'candidate:3 1 udp 2130706431 198.18.0.1 5002 typ host', sdpMid: '0', sdpMLineIndex: 0 },
    })
    rawInstance!.onicecandidate?.({
      candidate: { candidate: 'candidate:4 1 udp 2130706431 192.168.31.238 5003 typ host', sdpMid: '0', sdpMLineIndex: 0 },
    })

    expect(signals).toEqual([
      {
        type: 'offer',
        sdp: 'v=0\r\na=candidate:2 1 udp 2130706431 192.168.31.238 5001 typ host\r\n',
      },
      {
        type: 'ice',
        candidate: { candidate: 'candidate:4 1 udp 2130706431 192.168.31.238 5003 typ host', sdpMid: '0', sdpMLineIndex: 0 },
      },
    ])
    expect(transport.diagnostics().filteredLocalCandidates.total).toBe(2)
    await transport.close()
    await connecting
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

function ipv6(address: string): NetworkInterfaceInfo {
  return {
    ...ipv4(address),
    family: 'IPv6',
    netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    cidr: `${address}/128`,
    scopeid: 0,
  }
}
