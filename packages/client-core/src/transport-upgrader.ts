import {
  transportTierRank,
  transportUpgradeIceSchema,
  wireFromTransportTier,
  type TransportStats,
  type TransportTier,
} from '@dsh-remote/protocol'
import {
  RtcDataChannelTransport,
  UpgradedRtcDataChannelTransport,
  type RtcConnectionDetails,
  type RtcIceCandidateInit,
  type RtcIceServer,
  type RtcPathMode,
  type RtcDiagnosticEvent,
  type RtcPeerConnectionFactory,
  type SequencedOutboundTransport,
} from '@dsh-remote/webrtc'
import type { RemoteClientCore } from './index.js'

export interface UpgradeableSecureChannel {
  readonly outboundCounter: number
  attachIncomingLeg(leg: SequencedOutboundTransport): void
  markPreviousLegEndCounter?(previousLegEndCounter: number): void
  switchOutboundLeg(leg: SequencedOutboundTransport, options?: { closePrevious?: boolean; drainMs?: number }): Promise<number>
  detachLeg(leg: SequencedOutboundTransport): Promise<void>
  relayTrafficBytes?(): { sent: number; received: number }
}

export interface LiveTransportUpgradeTelemetry {
  attemptId: string
  from: TransportTier
  to?: RtcPathMode
  outcome: 'activated' | 'skipped-not-higher' | 'rejected' | 'failed' | 'aborted'
  durationMs: number
  relayBytesAtOutcome?: { sent: number; received: number }
  reason?: string
}

export interface ClientLiveTransportUpgraderOptions {
  connectionId: string
  rpc: RemoteClientCore
  channel: UpgradeableSecureChannel
  rtcFactory: RtcPeerConnectionFactory
  fetchIceServers?: (connectionId: string) => Promise<RtcIceServer[]>
  iceServersTimeoutMs?: number
  negotiateTimeoutMs?: number
  onUpgraded?: (mode: RtcPathMode, transport: UpgradedRtcDataChannelTransport) => void
  onDiagnostic?: (event: RtcDiagnosticEvent) => void
  onTelemetry?: (telemetry: LiveTransportUpgradeTelemetry) => void
}

interface UpgradeOfferResponse {
  attemptId?: unknown
  sdp?: unknown
}

interface UpgradeActivateResponse {
  activated?: unknown
  mode?: unknown
  previousLegEndCounter?: unknown
}

let nextUpgradeSeq = 1

function createAttemptId(): string {
  return `upg_${Date.now().toString(36)}_${(nextUpgradeSeq++).toString(36)}`
}

/**
 * Client-side live WebRTC transport upgrader (`remote.transport.upgrade.v1`).
 *
 * Negotiates WebRTC DataChannels over an already-authenticated Noise RPC session
 * and climbs monotonically `Relay -> TURN -> P2P -> LAN` without rotating Noise
 * keys or interrupting open streams.
 */
export class ClientLiveTransportUpgrader {
  private currentLeg?: UpgradedRtcDataChannelTransport
  private activeAttemptId?: string
  private activeRtc?: RtcDataChannelTransport
  private readonly pendingRemoteIce: RtcIceCandidateInit[] = []
  private remoteDescReady = false
  private promoting?: Promise<boolean>
  private closed = false
  private unsubscribeEvents?: () => void

  constructor(private readonly options: ClientLiveTransportUpgraderOptions) {
    this.unsubscribeEvents = options.rpc.onEvent(event => {
      if (this.closed || event.event !== 'remote.transport.upgrade.ice') return
      const parsed = transportUpgradeIceSchema.safeParse(event.data)
      if (!parsed.success || parsed.data.attemptId !== this.activeAttemptId) return
      if (!this.remoteDescReady || this.activeRtc === undefined) {
        if (this.pendingRemoteIce.length < 64) this.pendingRemoteIce.push(parsed.data.candidate)
        return
      }
      this.activeRtc.handleSignal({ type: 'ice', candidate: parsed.data.candidate })
    })
  }

  get currentMode(): TransportTier {
    return this.currentLeg?.mode ?? 'Relay'
  }

  get activeTransport(): UpgradedRtcDataChannelTransport | undefined {
    return this.currentLeg
  }

  getStats(): TransportStats | undefined {
    return this.currentLeg?.getStats()
  }

  connectionDetails(): Promise<RtcConnectionDetails> | undefined {
    return this.currentLeg?.connectionDetails()
  }

  promote(options: { preferLan?: boolean } = {}): Promise<boolean> {
    if (this.closed) return Promise.resolve(false)
    if (this.currentMode === 'LAN') return Promise.resolve(false)
    if (this.promoting !== undefined) return this.promoting
    const run = this.runAttempt(options.preferLan === true).finally(() => {
      if (this.promoting === run) this.promoting = undefined
    })
    this.promoting = run
    return run
  }

  /** Wait up to `windowMs` for an in-flight upgrade so initial reads prefer direct when fast. */
  async waitForInitialWindow(windowMs: number): Promise<boolean> {
    if (this.currentMode !== 'Relay') return true
    const inFlight = this.promoting ?? this.promote()
    if (windowMs <= 0) return false
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        inFlight,
        new Promise<boolean>(resolve => {
          timer = setTimeout(() => resolve(false), windowMs)
          ;(timer as { unref?: () => void }).unref?.()
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  private async runAttempt(preferLan: boolean): Promise<boolean> {
    const startedAt = Date.now()
    const fromMode = this.currentMode
    const attemptId = createAttemptId()
    this.activeAttemptId = attemptId
    this.pendingRemoteIce.length = 0
    this.remoteDescReady = false

    const emitTelemetry = (outcome: LiveTransportUpgradeTelemetry['outcome'], extra: Partial<LiveTransportUpgradeTelemetry> = {}) => {
      this.options.onTelemetry?.({
        attemptId,
        from: fromMode,
        outcome,
        durationMs: Math.max(0, Date.now() - startedAt),
        relayBytesAtOutcome: this.options.channel.relayTrafficBytes?.(),
        ...extra,
      })
    }

    let iceServers: RtcIceServer[] = []
    if (!preferLan && this.options.fetchIceServers !== undefined) {
      try {
        iceServers = await withTimeout(
          this.options.fetchIceServers(this.options.connectionId),
          this.options.iceServersTimeoutMs ?? 4_000,
        )
      } catch {
        iceServers = []
      }
    }
    if (this.closed) {
      emitTelemetry('aborted')
      return false
    }

    const localIceQueue: RtcIceCandidateInit[] = []
    let offerSent = false
    let offerResolve: ((sdp: string) => void) | undefined
    const offerCreated = new Promise<string>(resolve => { offerResolve = resolve })

    const rtc = new RtcDataChannelTransport({
      role: 'initiator',
      factory: this.options.rtcFactory,
      iceServers,
      negotiateTimeoutMs: this.options.negotiateTimeoutMs ?? 6_000,
      onDiagnostic: this.options.onDiagnostic,
      onSignal: signal => {
        if (this.closed || this.activeAttemptId !== attemptId) return
        if (signal.type === 'offer') {
          offerResolve?.(signal.sdp)
          return
        }
        if (signal.type === 'ice') {
          if (!offerSent) {
            if (localIceQueue.length < 64) localIceQueue.push(signal.candidate)
          } else {
            void this.options.rpc.rpc('remote.transport.upgrade.ice', { attemptId, candidate: signal.candidate }, undefined, 5_000).catch(() => undefined)
          }
        }
      },
    })
    this.activeRtc = rtc

    try {
      const openPromise = rtc.connect()
      // Prevent unhandled rejection if offer RPC fails before awaiting openPromise.
      openPromise.catch(() => undefined)
      const offerSdp = await withTimeout(offerCreated, 5_000)
      if (this.closed) throw new Error('Upgrader closed.')

      const answer = await this.options.rpc.rpc<UpgradeOfferResponse>(
        'remote.transport.upgrade.offer',
        { attemptId, sdp: offerSdp },
        undefined,
        8_000,
      )
      offerSent = true
      for (const candidate of localIceQueue.splice(0)) {
        void this.options.rpc.rpc('remote.transport.upgrade.ice', { attemptId, candidate }, undefined, 5_000).catch(() => undefined)
      }
      if (typeof answer?.sdp !== 'string' || answer.sdp.length === 0) {
        throw new Error('Invalid upgrade answer.')
      }
      rtc.handleSignal({ type: 'answer', sdp: answer.sdp })
      this.remoteDescReady = true
      for (const candidate of this.pendingRemoteIce.splice(0)) {
        rtc.handleSignal({ type: 'ice', candidate })
      }

      await openPromise
      if (this.closed) throw new Error('Upgrader closed.')

      let detectedMode: RtcPathMode | undefined
      for (let i = 0; i < 6; i += 1) {
        const details = await rtc.connectionDetails().catch(() => undefined)
        detectedMode = details?.mode
        if (detectedMode === 'LAN') break
        if (!preferLan && detectedMode !== undefined) break
        if (i < 5) await new Promise(resolve => setTimeout(resolve, 40))
      }

      if (detectedMode !== undefined && transportTierRank(detectedMode) <= transportTierRank(this.currentMode)) {
        void this.options.rpc.rpc('remote.transport.upgrade.abort', { attemptId }, undefined, 3_000).catch(() => undefined)
        await rtc.close().catch(() => undefined)
        emitTelemetry('skipped-not-higher', { to: detectedMode })
        return false
      }

      const candidateWire = detectedMode !== undefined ? wireFromTransportTier(detectedMode) : undefined
      const provisionalMode: RtcPathMode = detectedMode ?? 'P2P'
      const upgraded = new UpgradedRtcDataChannelTransport(rtc, provisionalMode, wireFromTransportTier(provisionalMode))

      // Attach inbound leg BEFORE telling the Host to switch its outbound leg.
      this.options.channel.attachIncomingLeg(upgraded)
      const activation = await this.options.rpc.rpc<UpgradeActivateResponse>(
        'remote.transport.upgrade.activate',
        {
          attemptId,
          ...(candidateWire !== undefined ? { transport: candidateWire } : {}),
        },
        undefined,
        6_000,
      )

      if (activation?.activated !== true) {
        await this.options.channel.detachLeg(upgraded)
        emitTelemetry('rejected')
        return false
      }

      const authoritativeMode: RtcPathMode = activation.mode === 'LAN' || activation.mode === 'P2P' || activation.mode === 'TURN'
        ? activation.mode
        : provisionalMode
      if (authoritativeMode !== upgraded.mode) {
        upgraded.updateMode(authoritativeMode, wireFromTransportTier(authoritativeMode))
      }
      // Atomically retire the previous outbound leg FIRST so no further frames
      // can be written to it and its close callback cannot fail the channel.
      const finalOldLegCounter = await this.options.channel.switchOutboundLeg(upgraded, { closePrevious: true })
      if (typeof activation.previousLegEndCounter === 'number') {
        this.options.channel.markPreviousLegEndCounter?.(activation.previousLegEndCounter)
      }
      this.currentLeg = upgraded
      // Now notify the Host of the true final frame count sent on the retired leg
      // over the newly active DataChannel so the Host can drain and close it safely.
      void this.options.rpc.rpc(
        'remote.transport.upgrade.drain',
        { attemptId, previousLegEndCounter: finalOldLegCounter },
        undefined,
        5_000,
      ).catch(() => undefined)
      this.options.onUpgraded?.(authoritativeMode, upgraded)
      emitTelemetry('activated', { to: authoritativeMode })
      return true
    } catch (error) {
      void this.options.rpc.rpc('remote.transport.upgrade.abort', { attemptId }, undefined, 3_000).catch(() => undefined)
      await rtc.close().catch(() => undefined)
      emitTelemetry(this.closed ? 'aborted' : 'failed', { reason: error instanceof Error ? error.name : 'Error' })
      return false
    } finally {
      if (this.activeAttemptId === attemptId) {
        this.activeAttemptId = undefined
        this.activeRtc = undefined
        this.pendingRemoteIce.length = 0
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.unsubscribeEvents?.()
    this.unsubscribeEvents = undefined
    const active = this.activeRtc
    this.activeRtc = undefined
    if (active !== undefined) await active.close().catch(() => undefined)
    const leg = this.currentLeg
    this.currentLeg = undefined
    if (leg !== undefined) await leg.close().catch(() => undefined)
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Operation timed out.')), timeoutMs)
        ;(timer as { unref?: () => void }).unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
