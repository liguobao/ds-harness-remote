import { expect, it, vi } from 'vitest'
import { connectPreferredTransport } from '../src/preferred-connection.js'
import type { AdaptiveTransport, AdaptiveTransportOptions } from '@dsh-remote/webrtc'

it('selects compatible independent connections with bounded waits and cleans up every loser', async () => {
  for (const scenario of ['direct-first', 'turn-first', 'turn-window', 'both-failed', 'legacy', 'cancel', 'auth-error', 'deadline', 'standby-closed', 'standby-timeout', 'long-config'] as const) {
    vi.useFakeTimers()
    const abort = new AbortController()
    const legs = new Map<string, any>()
    const create = vi.fn((attempt: string, hooks: Partial<AdaptiveTransportOptions>) => {
      let resolve!: () => void, reject!: (error: Error) => void
      const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no })
      const handlers = new Set<() => void>()
      const leg = { hooks, resolve, reject, open: true,
        connect: () => attempt === 'relay' ? Promise.resolve() : ready,
        getStats: () => ({ connected: leg.open, mode: attempt === 'direct' ? 'P2P' : attempt === 'turn' ? 'TURN' : 'Relay' }),
        close: vi.fn(async () => { leg.open = false; for (const cb of handlers) cb() }),
        onClose: (cb: () => void) => { handlers.add(cb); return () => handlers.delete(cb) },
      }
      legs.set(attempt, leg)
      return leg as unknown as AdaptiveTransport
    })
    let chosen: unknown
    const result = connectPreferredTransport(create, abort.signal).then(value => { chosen = value }, error => { chosen = error.message })
    const direct = legs.get('direct')!
    direct.hooks.onWebRtcStarted(8000)
    if (scenario !== 'legacy') direct.hooks.onParallelConnections()
    const turn = legs.get('turn')
    const fail = (leg: any) => leg.reject(Object.assign(new Error('ICE failed'), { code: 'RTC_NEGOTIATION_FAILED' }))
    try {
      if (scenario === 'direct-first') direct.resolve()
      if (scenario === 'standby-timeout') { turn.reject(Object.assign(new Error('Control timed out'), { code: 'TRANSPORT_SETUP_FAILED' })); await vi.advanceTimersByTimeAsync(0); expect(chosen).toBeUndefined(); direct.resolve() }
      if (scenario === 'long-config') { turn.hooks.onWebRtcStarted(30000); await vi.advanceTimersByTimeAsync(27000); expect(chosen).toBeUndefined(); direct.resolve() }
      if (scenario === 'turn-first') { turn.resolve(); await vi.advanceTimersByTimeAsync(2999); expect(chosen).toBeUndefined(); direct.resolve() }
      if (scenario === 'turn-window') { turn.resolve(); await vi.advanceTimersByTimeAsync(3000) }
      if (scenario === 'both-failed') { fail(direct); fail(turn) }
      if (scenario === 'legacy') { expect(legs.has('turn')).toBe(false); fail(direct); await vi.advanceTimersByTimeAsync(0); expect(direct.close).toHaveBeenCalled(); legs.get('turn').resolve() }
      if (scenario === 'cancel') abort.abort()
      if (scenario === 'auth-error') direct.reject(new Error('Unauthorized'))
      if (scenario === 'deadline') await vi.advanceTimersByTimeAsync(25000)
      if (scenario === 'standby-closed') { turn.resolve(); await vi.advanceTimersByTimeAsync(0); await turn.close(); await vi.advanceTimersByTimeAsync(3000); expect(chosen).toBeUndefined(); direct.resolve() }
      await result
      if (scenario === 'auth-error') expect(chosen).toBe('Unauthorized')
      else if (scenario === 'cancel') expect(typeof chosen).toBe('string')
      else expect(chosen, scenario).toBe(legs.get(['both-failed', 'deadline'].includes(scenario) ? 'relay' : ['turn-window', 'legacy'].includes(scenario) ? 'turn' : 'direct'))
      for (const leg of legs.values()) if (leg !== chosen) expect(leg.close, scenario).toHaveBeenCalled()
      expect(vi.getTimerCount(), scenario).toBe(0)
    } finally { abort.abort(); vi.useRealTimers() }
  }
})
