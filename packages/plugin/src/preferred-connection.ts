import { DirectPreferredRace } from '@dsh-remote/webrtc'
import type { AdaptiveTransport, AdaptiveTransportOptions } from '@dsh-remote/webrtc'

type Attempt = 'direct' | 'turn' | 'relay'
/** Prepare data paths only. The caller starts Noise once, on the winner. */
export async function connectPreferredTransport(
  create: (attempt: Attempt, hooks: Partial<AdaptiveTransportOptions>) => AdaptiveTransport,
  signal?: AbortSignal,
): Promise<AdaptiveTransport> {
  const lifetime = new AbortController()
  const cancel = () => lifetime.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  const race = new DirectPreferredRace<AdaptiveTransport>(lifetime.signal, 3_000, 25_000, true)
  const candidates = new Map<Attempt, AdaptiveTransport>()
  const unsubscribes: Array<() => void> = []
  let fatal: unknown
  let chosen: AdaptiveTransport | undefined
  let finished = false
  let succeeded = false
  const begin = (attempt: 'direct' | 'turn') => {
    if (finished || lifetime.signal.aborted || candidates.has(attempt)) return
    try {
      const transport = create(attempt, {
        signal: lifetime.signal, failOnWebRtcFallback: true, useServerNegotiateTimeout: true,
        onParallelConnections: attempt === 'direct' ? () => begin('turn') : undefined,
        onWebRtcStarted: timeoutMs => race.startAttempt(attempt, timeoutMs),
      })
      candidates.set(attempt, transport)
      let ready = false
      unsubscribes.push(transport.onClose(() => { if (ready) race.failed(attempt) }))
      void transport.connect().then(() => {
        if (finished || lifetime.signal.aborted) return
        const mode = transport.getStats().mode
        if (attempt === 'direct' ? mode !== 'LAN' && mode !== 'P2P' : mode !== 'TURN') {
          race.failed(attempt)
          void transport.close()
          if (attempt === 'direct') begin('turn')
          return
        }
        ready = true
        race.ready(attempt, transport)
      }).catch(error => {
        if (finished || lifetime.signal.aborted) return
        const candidateFailed = ['RTC_NEGOTIATION_FAILED', 'TRANSPORT_SETUP_FAILED'].includes(error?.code)
          || (error?.code === 'TRANSPORT_CLOSED' && error?.retryable === true)
        if (!candidateFailed) { fatal = error; lifetime.abort(); return }
        race.failed(attempt)
        // Old gateways use the same order sequentially; do not create a
        // competing socket until the failed direct socket has been closed.
        void transport.close().then(() => { if (attempt === 'direct') begin('turn') })
      })
    } catch (error) { fatal = error; lifetime.abort() }
  }
  begin('direct')
  try {
    try {
      chosen = (await race.result).value
      signal?.throwIfAborted()
      if (!chosen.getStats().connected) throw new Error('Selected RTC closed')
      succeeded = true
      return chosen
    } catch (error) {
      if (fatal) throw fatal
      signal?.throwIfAborted()
      finished = true
      for (const candidate of candidates.values()) void candidate.close()
      chosen = create('relay', { signal })
      await chosen.connect()
      signal?.throwIfAborted()
      succeeded = true
      return chosen
    }
  } finally {
    finished = true
    signal?.removeEventListener('abort', cancel)
    for (const unsubscribe of unsubscribes) unsubscribe()
    for (const candidate of candidates.values()) if (candidate !== chosen || !succeeded) void candidate.close()
    if (!succeeded) void chosen?.close()
  }
}
