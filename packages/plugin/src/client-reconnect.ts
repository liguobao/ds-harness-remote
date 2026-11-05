import type { ResolvedConfig } from './config.js'

/** Retry only carrier establishment, never an RPC or an outgoing user action. */
export class ClientReconnect {
  private pending?: AbortController

  constructor(private readonly config: ResolvedConfig['reconnect']) {}

  cancel(): void {
    this.pending?.abort()
    this.pending = undefined
  }

  start(connect: (signal: AbortSignal) => Promise<void>, error?: Error): void {
    this.cancel()
    if (!this.config.enabled || !canReconnect(error)) return
    const pending = new AbortController()
    this.pending = pending
    void this.run(connect, pending).finally(() => {
      if (this.pending === pending) this.pending = undefined
    })
  }

  private async run(connect: (signal: AbortSignal) => Promise<void>, pending: AbortController): Promise<void> {
    // Every retry, including the first, waits a full-jitter draw from
    // [0, maxDelayMs]: a tight retry loop against a failing carrier is
    // impossible, while a short blip still recovers quickly on average.
    // `jitter` is not applied on top of full jitter.
    while (!pending.signal.aborted) {
      const delay = Math.random() * this.config.maxDelayMs
      await new Promise<void>(resolve => {
        const finish = () => {
          clearTimeout(timer)
          pending.signal.removeEventListener('abort', finish)
          resolve()
        }
        const timer = setTimeout(finish, delay)
        pending.signal.addEventListener('abort', finish, { once: true })
      })
      if (pending.signal.aborted) return
      try {
        await connect(pending.signal)
        return
      } catch (error) {
        if (!canReconnect(error)) return
      }
    }
  }
}

function canReconnect(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return true
  const failure = error as { code?: unknown; retryable?: unknown }
  // Explicit protocol/authentication failures fail closed, including 4003.
  // Unknown network exceptions (e.g. fetch TypeError) can recover.
  if (failure.code !== undefined && ![
    'HOST_OFFLINE', 'CONNECTION_FAILED', 'CONNECTION_NOT_FOUND', 'TRANSPORT_CLOSED', 'RPC_TIMEOUT',
    'P2P_FAILED', 'TURN_UNAVAILABLE', 'RELAY_UNAVAILABLE', 'RATE_LIMITED', 'SLOW_CONSUMER', 'INTERNAL_ERROR',
  ].includes(String(failure.code))) return false
  return failure.retryable !== false
}
