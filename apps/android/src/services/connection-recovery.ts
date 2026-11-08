import type { ConnectionPhase, TransportPreference } from '../types'

interface RecoveryState {
  connection: { phase: ConnectionPhase; stats: { mode: string }; retryable?: boolean; errorCode?: string }
  selectedDevice?: { deviceId: string }
  reauthRequired: boolean
  transportPreference: TransportPreference
}

// First retry is immediate: a dropped P2P path should recover in ~1s over
// the relay, not after a fixed 1s timer plus the whole connect pipeline.
const RETRY_DELAYS_MS = [0, 1_000, 3_000, 8_000, 15_000, 30_000, 30_000, 60_000]
// When the Server explicitly reports HOST_OFFLINE / DEVICE_OFFLINE, skip the
// 0ms P2P->Relay fast-retry and use jittered exponential backoff.
const HOST_OFFLINE_RETRY_DELAYS_MS = [3_000, 6_000, 12_000, 24_000, 30_000, 60_000, 60_000, 60_000]
/**
 * A connection that never established gets fewer, faster retries: the first
 * attempt already waited out its WebRTC budget, and every retry runs the
 * full handshake. Relay-only retries here are cheap; endless retries are not.
 */
const FIRST_CONNECT_RETRY_COUNT = 2

/** Recover a previously connected Host while its runtime is retained; never replay a mutation. */
export class ForegroundConnectionRecovery {
  private active = false
  private hostId?: string
  private armed = false
  private attempts = 0
  private lastMode = 'Disconnected'
  private timer?: ReturnType<typeof setTimeout>
  private inFlight = false
  private exhausted = false

  constructor(
    private readonly read: () => RecoveryState,
    private readonly reconnect: (options: { forceRelay?: boolean }) => Promise<boolean>,
    private readonly onExhausted: () => void = () => undefined,
  ) {}

  setActive(active: boolean): void {
    if (this.active === active) return
    this.active = active
    if (active) {
      // Returning to the foreground is a fresh chance (new network, better
      // signal): re-arm even after the previous cycle exhausted itself.
      this.attempts = 0
      this.exhausted = false
      this.cancelTimer()
    }
    this.update()
  }

  update(): void {
    const state = this.read()
    const hostId = state.selectedDevice?.deviceId
    let reset = false
    if (hostId !== this.hostId || state.connection.phase === 'disconnected' || state.reauthRequired) {
      this.cancelTimer()
      this.hostId = hostId
      this.armed = false
      this.attempts = 0
      this.exhausted = false
      reset = true
    }
    if (state.reauthRequired) return
    if (state.connection.phase === 'connected') {
      this.armed = true
      this.lastMode = state.connection.stats.mode
      if (!this.inFlight) {
        this.attempts = 0
        this.exhausted = false
      }
    }
    // A reset means the lifecycle changed (new host, logout, sign-out): this
    // call must not schedule a retry for state that no longer applies.
    if (reset) return
    if (!this.active || hostId === undefined || state.connection.phase !== 'offline'
      || state.connection.retryable === false) {
      this.cancelTimer()
      // A refused (non-retryable) offline state has no retry owner; still
      // release the retained native service exactly once.
      if (this.active && state.connection.phase === 'offline'
        && state.connection.retryable === false && !this.exhausted) {
        this.exhausted = true
        this.onExhausted()
      }
      return
    }
    if (this.timer !== undefined || this.inFlight) return
    // Late-connected hosts use the full ladder; a first attempt that never
    // established retries immediately over Relay before giving up.
    const hostOffline = state.connection.errorCode === 'HOST_OFFLINE' || state.connection.errorCode === 'DEVICE_OFFLINE'
    const maxAttempts = this.armed ? RETRY_DELAYS_MS.length : FIRST_CONNECT_RETRY_COUNT
    if (this.attempts >= maxAttempts) {
      if (!this.exhausted) {
        this.exhausted = true
        this.onExhausted()
      }
      // If a previously connected Host remains in any retryable offline state,
      // keep a low-frequency probe (60s jittered for HOST_OFFLINE/DEVICE_OFFLINE,
      // 120s for other retryable transport failures) so prolonged Host/Server
      // outages recover automatically without manual intervention.
      if (!this.armed) {
        return
      }
    }
    const baseDelay = this.attempts >= maxAttempts
      ? (hostOffline ? 60_000 : 120_000)
      : ((hostOffline ? HOST_OFFLINE_RETRY_DELAYS_MS : RETRY_DELAYS_MS)[this.attempts] ?? 60_000)
    const delayMs = hostOffline ? Math.round(baseDelay * (0.5 + Math.random() * 0.5)) : baseDelay
    this.timer = setTimeout(() => {
      this.timer = undefined
      // Recheck after the delay: logout, manual connection or a Host change
      // must not be overtaken by an old recovery callback.
      const current = this.read()
      if (!this.active || current.selectedDevice?.deviceId !== hostId
        || current.connection.phase !== 'offline' || current.connection.retryable === false || current.reauthRequired) return
      this.attempts += 1
      const forceRelay = current.transportPreference === 'auto'
        && (this.lastMode !== 'Relay' || this.attempts > 1)
      this.inFlight = true
      void this.reconnect({ ...(forceRelay ? { forceRelay: true } : {}) })
        .catch(() => false)
        .finally(() => {
          this.inFlight = false
          this.update()
        })
    }, delayMs)
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }
}
