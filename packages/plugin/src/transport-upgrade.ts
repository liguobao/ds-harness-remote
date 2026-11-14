import { createEvent, type RemoteMessage } from '@dsh-remote/protocol'
import {
  RtcDataChannelTransport,
  type RtcIceCandidateInit,
  type RtcIceServer,
  type RtcPeerConnectionFactory,
  type RtcSignal,
} from '@dsh-remote/webrtc'
import { z } from 'zod'
import type { SafeLogger } from './logging.js'
import { RpcError } from './safe-error.js'

export const TRANSPORT_UPGRADE_CAPABILITY = 'remote.transport.upgrade.v1' as const

const candidateSchema = z.object({
  candidate: z.string().max(4096).optional(),
  sdpMid: z.string().max(128).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
}).strict()

const offerSchema = z.object({
  attemptId: z.string().min(1).max(64),
  sdp: z.string().min(1).max(128 * 1024),
}).strict()

const iceSchema = z.object({
  attemptId: z.string().min(1).max(64),
  candidate: candidateSchema,
}).strict()

const activateSchema = z.object({
  attemptId: z.string().min(1).max(64),
  transport: z.enum(['lan', 'p2p', 'turn']),
}).strict()

const abortSchema = z.object({
  attemptId: z.string().min(1).max(64).optional(),
}).strict()

export type TransportTier = 'Relay' | 'TURN' | 'P2P' | 'LAN'

function tierRank(mode: TransportTier | undefined): number {
  switch (mode) {
    case 'LAN': return 3
    case 'P2P': return 2
    case 'TURN': return 1
    default: return 0
  }
}

function modeFromWire(transport: 'lan' | 'p2p' | 'turn'): 'LAN' | 'P2P' | 'TURN' {
  return transport === 'lan' ? 'LAN' : transport === 'p2p' ? 'P2P' : 'TURN'
}

export interface TransportUpgradeDriver {
  readonly connectionId: string
  readonly peerDeviceId: string
  currentMode(): TransportTier
  loadRtcFactory(): Promise<RtcPeerConnectionFactory | undefined>
  fetchIceServers(connectionId: string): Promise<RtcIceServer[]>
  onReceiveCiphertext(data: Uint8Array): void
  adoptRtc(rtc: RtcDataChannelTransport, mode: 'LAN' | 'P2P' | 'TURN'): Promise<void>
  publishEvent(message: RemoteMessage): Promise<void>
}

interface UpgradeAttempt {
  attemptId: string
  rtc: RtcDataChannelTransport
  opened: boolean
  activated: boolean
  closed: boolean
}

/**
 * In-band encrypted transport upgrade coordinator for one authenticated
 * connection. Allows a session that started immediately over Relay to promote
 * its underlying carrier to TURN -> P2P -> LAN without rotating Noise keys or
 * dropping active streams.
 */
export class TransportUpgradeHost {
  private candidate?: UpgradeAttempt
  private closed = false

  constructor(
    private readonly driver: TransportUpgradeDriver,
    private readonly logger?: SafeLogger,
  ) {}

  async offer(params: unknown): Promise<{ attemptId: string; sdp: string }> {
    if (this.closed) throw new RpcError('CONNECTION_FAILED', 'Connection is closed.')
    const { attemptId, sdp } = offerSchema.parse(params)
    await this.disposeCandidate()

    const factory = await this.driver.loadRtcFactory()
    if (!factory || this.closed) {
      throw new RpcError('FEATURE_NOT_SUPPORTED', 'WebRTC backend is unavailable on this Host.')
    }
    let iceServers: RtcIceServer[] = []
    try {
      iceServers = await this.driver.fetchIceServers(this.driver.connectionId)
    } catch {
      // Direct LAN / STUN candidates can still succeed without TURN.
    }
    if (this.closed) throw new RpcError('CONNECTION_FAILED', 'Connection is closed.')

    let answerSdp: string | undefined
    let resolveAnswer!: (sdp: string) => void
    let rejectAnswer!: (error: Error) => void
    const answerPromise = new Promise<string>((resolve, reject) => {
      resolveAnswer = resolve
      rejectAnswer = reject
    })

    const bufferedIce: RtcIceCandidateInit[] = []
    let answerReturned = false

    const rtc = new RtcDataChannelTransport({
      role: 'responder',
      factory,
      iceServers,
      negotiateTimeoutMs: 12_000,
      label: `upgrade<-${this.driver.peerDeviceId}`,
      onSignal: (signal: RtcSignal) => {
        if (this.closed || this.candidate?.attemptId !== attemptId) return
        if (signal.type === 'answer') {
          answerSdp = signal.sdp
          resolveAnswer(signal.sdp)
          return
        }
        if (signal.type === 'ice') {
          if (!answerReturned) {
            bufferedIce.push(signal.candidate)
          } else {
            void this.driver.publishEvent(createEvent('remote.transport.upgrade.ice', {
              attemptId,
              candidate: signal.candidate,
            })).catch(() => undefined)
          }
        }
      },
    })

    const attempt: UpgradeAttempt = {
      attemptId,
      rtc,
      opened: false,
      activated: false,
      closed: false,
    }
    this.candidate = attempt

    // Even before explicit activate, the client switches its outbound leg right
    // after activate() or concurrently; any ciphertext arriving on the new
    // DataChannel belongs to this exact Noise session.
    rtc.onMessage(data => {
      if (!this.closed && !attempt.closed) this.driver.onReceiveCiphertext(data)
    })
    rtc.onClose(() => {
      if (!attempt.activated && this.candidate === attempt) {
        attempt.closed = true
        this.candidate = undefined
      }
    })

    void rtc.connect().then(() => {
      attempt.opened = true
    }).catch(error => {
      rejectAnswer(error instanceof Error ? error : new Error(String(error)))
      if (!attempt.activated && this.candidate === attempt) {
        attempt.closed = true
        this.candidate = undefined
        void rtc.close().catch(() => undefined)
      }
    })

    rtc.handleSignal({ type: 'offer', sdp })
    const finalAnswer = answerSdp ?? await answerPromise
    answerReturned = true
    for (const candidate of bufferedIce) {
      void this.driver.publishEvent(createEvent('remote.transport.upgrade.ice', {
        attemptId,
        candidate,
      })).catch(() => undefined)
    }
    return { attemptId, sdp: finalAnswer }
  }

  async addIce(params: unknown): Promise<{ ok: true }> {
    const { attemptId, candidate } = iceSchema.parse(params)
    const current = this.candidate
    if (current && current.attemptId === attemptId && !current.closed) {
      current.rtc.handleSignal({ type: 'ice', candidate })
    }
    return { ok: true }
  }

  async activate(params: unknown): Promise<{ activated: boolean; mode: TransportTier }> {
    const { attemptId, transport } = activateSchema.parse(params)
    const current = this.candidate
    if (!current || current.attemptId !== attemptId || current.closed) {
      throw new RpcError('INVALID_MESSAGE', 'No matching transport upgrade candidate is open.')
    }
    // Wait briefly if responder DataChannel open callback trails the initiator's.
    if (!current.opened) {
      await current.rtc.connect()
    }
    const detected = current.rtc.selectedPathMode() ?? modeFromWire(transport)
    const targetMode: 'LAN' | 'P2P' | 'TURN' = tierRank(detected) >= tierRank(modeFromWire(transport))
      ? detected
      : modeFromWire(transport)
    if (tierRank(targetMode) <= tierRank(this.driver.currentMode())) {
      await this.disposeCandidate()
      return { activated: false, mode: this.driver.currentMode() }
    }
    this.candidate = undefined
    current.activated = true
    await this.driver.adoptRtc(current.rtc, targetMode)
    this.logger?.info('upgraded live peer transport', {
      attemptId,
      mode: targetMode,
    })
    return { activated: true, mode: targetMode }
  }

  async abort(params: unknown): Promise<{ ok: true }> {
    const { attemptId } = abortSchema.parse(params)
    if (!attemptId || this.candidate?.attemptId === attemptId) {
      await this.disposeCandidate()
    }
    return { ok: true }
  }

  async closeAll(): Promise<void> {
    this.closed = true
    await this.disposeCandidate()
  }

  private async disposeCandidate(): Promise<void> {
    const prev = this.candidate
    this.candidate = undefined
    if (prev && !prev.activated && !prev.closed) {
      prev.closed = true
      await prev.rtc.close().catch(() => undefined)
    }
  }
}
