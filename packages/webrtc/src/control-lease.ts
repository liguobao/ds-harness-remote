export interface ControlLeaseAck { connectionId: string; requestId: string; ticket: string; leaseMs: number }

const WEBRTC_LEASE_MS = 300_000

/** A connection authorization deadline; socket activity alone never renews it. */
export class ControlLease {
  private confirmed = false
  private stopped = false
  private sent?: { id: string; mono: number; wall: number }
  private deadline?: { mono: number; wall: number }
  private sequence = 0
  private timer?: ReturnType<typeof setInterval>
  private lastRequest = -Infinity

  constructor(
    readonly connectionId: string,
    private ticket: string,
    private readonly request: (payload: { connectionId: string; requestId: string; ticket: string }) => void,
    private readonly expired: () => void,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.tick(), 1_000)
    // Bound first confirmation too, but it never permits detached operation.
    this.deadline = { mono: performance.now() + WEBRTC_LEASE_MS, wall: Date.now() + WEBRTC_LEASE_MS }
    this.tick(true)
  }

  valid(): boolean {
    if (this.stopped) return false
    const d = this.deadline
    if (d && (performance.now() >= d.mono || Date.now() >= d.wall)) {
      this.stop()
      this.expired()
      return false
    }
    return true
  }

  remainingMs(): number | undefined {
    if (!this.confirmed || this.stopped || !this.deadline) return undefined
    return Math.max(0, Math.min(this.deadline.mono - performance.now(), this.deadline.wall - Date.now()))
  }

  canDetach(): boolean { return this.confirmed && this.valid() }
  recoveryTicket(): string | undefined { return this.canDetach() ? this.ticket : undefined }

  tick(force = false): void {
    if (!this.valid()) return
    const mono = performance.now()
    if (!force && mono - this.lastRequest < 25_000) return
    const sent = { id: String(++this.sequence), mono, wall: Date.now() }
    this.lastRequest = mono
    try {
      this.request({ connectionId: this.connectionId, requestId: sent.id, ticket: this.ticket })
      this.sent = sent
    } catch { /* Keep the existing deadline while control is unavailable. */ }
  }

  acknowledge(ack: ControlLeaseAck): void {
    if (!this.valid() || ack.connectionId !== this.connectionId || ack.leaseMs !== WEBRTC_LEASE_MS) return
    const sent = this.sent
    if (!sent || sent.id !== ack.requestId) return
    // Late replies cannot create a fresh five-minute window.
    if (performance.now() - sent.mono >= 30_000 || Date.now() - sent.wall >= 30_000) return
    this.sent = undefined
    this.ticket = ack.ticket
    this.confirmed = true
    this.deadline = { mono: sent.mono + WEBRTC_LEASE_MS, wall: sent.wall + WEBRTC_LEASE_MS }
  }

  stop(): void {
    this.stopped = true
    clearInterval(this.timer)
    this.timer = undefined
    this.sent = undefined
  }
}
