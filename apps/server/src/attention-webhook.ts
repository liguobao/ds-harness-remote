import { attentionDigestSchema, type AttentionDigest } from '@dsh-remote/protocol'
import { Logger } from './logger.js'

export interface AttentionWebhookPayload {
  event: 'host.attention.signal'
  hostId: string
  hostName: string
  digest: AttentionDigest
}

export interface AttentionWebhookOptions {
  logger?: Logger
  fetch?: typeof fetch
  timeoutMs?: number
  maxConcurrency?: number
  baseBackoffMs?: number
  maxBackoffMs?: number
  circuitBreakerThreshold?: number
}

const DEFAULT_TIMEOUT_MS = 4_000
const DEFAULT_MAX_CONCURRENCY = 2
const DEFAULT_BASE_BACKOFF_MS = 1_000
const DEFAULT_MAX_BACKOFF_MS = 60_000
const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 5

const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9]{0,31}$/
const SAFE_ERROR_CODE = /^[A-Z0-9_]{1,32}$/

function safeErrorName(error: unknown): string {
  try {
    const name = error instanceof Error ? error.name : undefined
    return typeof name === 'string' && SAFE_ERROR_NAME.test(name) ? name : 'Error'
  } catch {
    return 'Error'
  }
}

function safeErrorCode(error: unknown): string | undefined {
  try {
    const direct = (error as { code?: unknown } | null | undefined)?.code
    if (typeof direct === 'string' && SAFE_ERROR_CODE.test(direct)) return direct
    const causeCode = (error as { cause?: { code?: unknown } } | null | undefined)?.cause?.code
    if (typeof causeCode === 'string' && SAFE_ERROR_CODE.test(causeCode)) return causeCode
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Optional, zero-plaintext blind webhook dispatcher for `host.attention.signal`.
 *
 * Safety invariants:
 * - Only dispatches `{ event, hostId, hostName, digest }` after strict schema check.
 * - `redirect: 'manual'` and bounded timeout prevent SSRF redirect bypasses and hangs.
 * - Single-slot coalescing per `hostId` guarantees bounded memory and latest-state delivery.
 * - Global concurrency is capped (`<= 2`) with exponential backoff + circuit breaker.
 * - Logs only `url.origin` and status/error codes — never path, query params, or tokens.
 */
export class AttentionWebhookDispatcher {
  readonly targetOrigin: string
  private readonly url: string
  private readonly logger: Logger
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly maxConcurrency: number
  private readonly baseBackoffMs: number
  private readonly maxBackoffMs: number
  private readonly circuitBreakerThreshold: number

  private readonly pending = new Map<string, AttentionWebhookPayload>()
  private readonly inFlightHosts = new Set<string>()
  private readonly activeAlerts = new Set<string>()
  private readonly shutdownController = new AbortController()
  private inFlightCount = 0
  private consecutiveFailures = 0
  private backoffUntil = 0
  private circuitOpenUntil = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private closed = false

  constructor(url: URL, options: AttentionWebhookOptions = {}) {
    this.url = url.toString()
    this.targetOrigin = url.origin
    this.logger = options.logger ?? new Logger('attention-webhook', 'info')
    this.fetchImpl = options.fetch ?? fetch
    this.timeoutMs = Math.max(100, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    this.maxConcurrency = Math.max(1, Math.min(DEFAULT_MAX_CONCURRENCY, options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY))
    this.baseBackoffMs = Math.max(50, options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS)
    this.maxBackoffMs = Math.max(this.baseBackoffMs, options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS)
    this.circuitBreakerThreshold = Math.max(1, options.circuitBreakerThreshold ?? DEFAULT_CIRCUIT_BREAKER_THRESHOLD)
  }

  notify(hostId: string, hostName: string, rawDigest: AttentionDigest): void {
    if (this.closed) return
    const digest = attentionDigestSchema.parse(rawDigest)
    const isClear = digest.urgentKind === 'clear'
    const isNonSilent = digest.urgency !== 'silent'
    const hadAlert = this.activeAlerts.has(hostId)

    if (isClear) {
      if (!hadAlert) return
    } else if (!isNonSilent) {
      return
    }

    const now = Date.now()
    if (this.circuitOpenUntil > now) {
      return
    }

    if (isClear) {
      this.activeAlerts.delete(hostId)
    } else {
      this.activeAlerts.add(hostId)
    }

    // Single-slot coalescing: keep only the latest unsent payload per host.
    this.pending.set(hostId, {
      event: 'host.attention.signal',
      hostId,
      hostName,
      digest,
    })
    this.pump()
  }

  cancel(hostId: string): void {
    this.pending.delete(hostId)
    this.activeAlerts.delete(hostId)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.pending.clear()
    this.activeAlerts.clear()
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
    this.shutdownController.abort()
  }

  private clearRetryTimer(): void {
    if (this.retryTimer === undefined) return
    clearTimeout(this.retryTimer)
    this.retryTimer = undefined
  }

  private schedulePump(delayMs: number): void {
    if (this.closed || this.retryTimer !== undefined) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      this.pump()
    }, Math.max(1, delayMs))
    this.retryTimer.unref()
  }

  private pump(): void {
    if (this.closed || this.pending.size === 0) return
    const now = Date.now()
    if (this.circuitOpenUntil > now) return
    if (this.backoffUntil > now) {
      this.schedulePump(this.backoffUntil - now)
      return
    }

    while (this.inFlightCount < this.maxConcurrency) {
      let next: AttentionWebhookPayload | undefined
      for (const [hostId, payload] of this.pending) {
        if (!this.inFlightHosts.has(hostId)) {
          next = payload
          this.pending.delete(hostId)
          break
        }
      }
      if (next === undefined) break
      this.inFlightHosts.add(next.hostId)
      this.inFlightCount += 1
      void this.deliver(next)
    }
  }

  private async deliver(payload: AttentionWebhookPayload): Promise<void> {
    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.any([
          AbortSignal.timeout(this.timeoutMs),
          this.shutdownController.signal,
        ]),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      try {
        if (response.ok) {
          this.recordSuccess()
        } else {
          this.recordFailure({ status: response.status })
        }
      } finally {
        await response.body?.cancel().catch(() => {})
      }
    } catch (error) {
      if (!this.closed) {
        this.recordFailure({
          errorName: safeErrorName(error),
          errorCode: safeErrorCode(error),
        })
      }
    } finally {
      this.inFlightHosts.delete(payload.hostId)
      this.inFlightCount -= 1
      if (!this.closed) this.pump()
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0
    this.backoffUntil = 0
    this.circuitOpenUntil = 0
    this.clearRetryTimer()
  }

  private recordFailure(detail: { status?: number; errorName?: string; errorCode?: string }): void {
    this.consecutiveFailures += 1
    const now = Date.now()
    if (this.consecutiveFailures >= this.circuitBreakerThreshold) {
      this.circuitOpenUntil = now + this.maxBackoffMs
      this.backoffUntil = this.circuitOpenUntil
      this.pending.clear()
      this.clearRetryTimer()
      this.logger.warn('attention_webhook_circuit_open', {
        origin: this.targetOrigin,
        ...(detail.status !== undefined ? { status: detail.status } : {}),
        ...(detail.errorName !== undefined ? { errorName: detail.errorName } : {}),
        ...(detail.errorCode !== undefined ? { errorCode: detail.errorCode } : {}),
        consecutiveFailures: this.consecutiveFailures,
        backoffMs: this.maxBackoffMs,
      })
      return
    }

    const backoffMs = Math.min(
      this.maxBackoffMs,
      this.baseBackoffMs * (2 ** (this.consecutiveFailures - 1)),
    )
    this.backoffUntil = Math.max(this.backoffUntil, now + backoffMs)
    this.logger.warn('attention_webhook_delivery_failed', {
      origin: this.targetOrigin,
      ...(detail.status !== undefined ? { status: detail.status } : {}),
      ...(detail.errorName !== undefined ? { errorName: detail.errorName } : {}),
      ...(detail.errorCode !== undefined ? { errorCode: detail.errorCode } : {}),
      consecutiveFailures: this.consecutiveFailures,
      backoffMs,
    })
  }
}
