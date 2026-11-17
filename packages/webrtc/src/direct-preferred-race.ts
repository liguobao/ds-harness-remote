/** One decision per logical connection; no business data flows before selection. */
export class DirectPreferredRace<T> {
  readonly result: Promise<{ attempt: 'direct' | 'turn'; value: T }>
  private resolve!: (winner: { attempt: 'direct' | 'turn'; value: T }) => void
  private reject!: (error: Error) => void
  private settled = false
  private windowExpired = false
  private directFailed = false
  private turnFailed = false
  private standby?: T
  private windowTimer?: ReturnType<typeof setTimeout>
  private deadlineTimer?: ReturnType<typeof setTimeout>
  private deadlineAt: number
  private readonly started = new Set<'direct' | 'turn'>()
  private readonly abort = () => this.finish(undefined, new Error('RTC race aborted'))

  constructor(private readonly signal: AbortSignal, private readonly windowMs = 3_000, deadlineMs = 12_000, deferWindow = false) {
    this.result = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject })
    this.deadlineAt = Date.now() + deadlineMs
    this.armDeadline(deadlineMs)
    signal.addEventListener('abort', this.abort, { once: true })
    if (signal.aborted) this.abort()
    else if (!deferWindow) this.startWindow()
  }

  /** Preserve each configured RTC budget without allowing repeated events to prolong it. */
  startAttempt(attempt: 'direct' | 'turn', timeoutMs: number): void {
    if (this.settled || this.started.has(attempt)) return
    this.started.add(attempt)
    if (attempt === 'direct') this.startWindow()
    const deadline = Date.now() + timeoutMs
    if (deadline > this.deadlineAt) {
      this.deadlineAt = deadline
      clearTimeout(this.deadlineTimer)
      this.armDeadline(timeoutMs)
    }
  }

  private armDeadline(delayMs: number): void {
    this.deadlineTimer = setTimeout(() => {
      this.windowExpired = true
      if (!this.chooseStandby()) this.finish(undefined, new Error('RTC race timed out'))
    }, delayMs)
  }

  startWindow(): void {
    if (this.settled || this.windowTimer !== undefined) return
    this.windowTimer = setTimeout(() => {
      this.windowExpired = true
      this.chooseStandby()
    }, this.windowMs)
  }

  ready(attempt: 'direct' | 'turn', value: T): void {
    if (this.settled || (attempt === 'direct' ? this.directFailed : this.turnFailed)) return
    if (attempt === 'direct') this.finish({ attempt, value })
    else { this.standby = value; this.chooseStandby() }
  }

  failed(attempt: 'direct' | 'turn'): void {
    if (this.settled) return
    if (attempt === 'direct') this.directFailed = true
    else { this.turnFailed = true; this.standby = undefined }
    if (this.directFailed && this.turnFailed) this.finish(undefined, new Error('Both RTC attempts failed'))
    else this.chooseStandby()
  }

  private chooseStandby(): boolean {
    if (this.standby === undefined || !(this.windowExpired || this.directFailed)) return false
    this.finish({ attempt: 'turn', value: this.standby })
    return true
  }

  private finish(winner?: { attempt: 'direct' | 'turn'; value: T }, error?: Error): void {
    if (this.settled) return
    this.settled = true
    clearTimeout(this.windowTimer)
    clearTimeout(this.deadlineTimer)
    this.signal.removeEventListener('abort', this.abort)
    this.standby = undefined
    if (winner) this.resolve(winner)
    else this.reject(error ?? new Error('RTC race failed'))
  }
}
