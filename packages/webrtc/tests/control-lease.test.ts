import { afterEach, describe, expect, it, vi } from 'vitest'
import { ControlLease } from '../src/control-lease.js'

const requests: Array<{ connectionId: string; requestId: string; ticket: string }> = []
function setup() {
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setInterval', 'clearInterval'] })
  requests.length = 0
  const expired = vi.fn()
  const lease = new ControlLease('connection', 'initial', p => { requests.push(p) }, expired)
  lease.start()
  const ack = (requestId = requests.at(-1)!.requestId) => lease.acknowledge({ connectionId: 'connection', requestId, ticket: 'renewed', leaseMs: 300_000 })
  return { lease, ack, expired }
}
afterEach(() => { vi.useRealTimers() })

describe('connection authorization lease', () => {
  it('requires a matched confirmation and counts the deadline from the request, not receipt', () => {
    const { lease, ack, expired } = setup()
    expect(lease.canDetach()).toBe(false)
    expect(lease.remainingMs()).toBeUndefined()
    ack('unknown')
    expect(lease.canDetach()).toBe(false)
    vi.advanceTimersByTime(10_000)
    ack()
    expect(lease.canDetach()).toBe(true)
    expect(lease.recoveryTicket()).toBe('renewed')
    expect(lease.remainingMs()).toBe(290_000)
    vi.advanceTimersByTime(290_000)
    expect(lease.canDetach()).toBe(false)
    expect(expired).toHaveBeenCalledOnce()
    expect(lease.remainingMs()).toBeUndefined()
  })

  it('does not renew from stale replies, unanswered retries, or reconnection attempts', () => {
    const { lease, ack, expired } = setup()
    ack()
    const first = requests[0]!.requestId
    vi.advanceTimersByTime(100_000)
    ack(first)
    vi.advanceTimersByTime(200_000)
    expect(expired).toHaveBeenCalledOnce()
    expect(lease.valid()).toBe(false)
  })

  it('checks elapsed time synchronously after timer suspension and cannot revive an expired lease', () => {
    const { lease, ack, expired } = setup()
    ack()
    vi.setSystemTime(Date.now() + 300_001)
    expect(lease.valid()).toBe(false)
    ack()
    expect(expired).toHaveBeenCalledOnce()
    expect(lease.canDetach()).toBe(false)
  })

  it('rate-limits failed attempts while a forced recovery confirmation can retry immediately', () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setInterval', 'clearInterval'] })
    const request = vi.fn(() => { throw new Error('control unavailable') })
    const lease = new ControlLease('connection', 'ticket', request, vi.fn())
    lease.start()
    vi.advanceTimersByTime(24_000)
    expect(request).toHaveBeenCalledTimes(1)
    lease.tick(true)
    expect(request).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(25_000)
    expect(request).toHaveBeenCalledTimes(3)
    lease.stop()
  })

  it('renews an active lease with fresh confirmation and cancels work on local disposal', () => {
    const { lease, ack, expired } = setup()
    ack()
    vi.advanceTimersByTime(200_000)
    ack()
    vi.advanceTimersByTime(100_000)
    expect(lease.canDetach()).toBe(true)
    lease.stop()
    const count = requests.length
    vi.advanceTimersByTime(400_000)
    expect(requests).toHaveLength(count)
    expect(expired).not.toHaveBeenCalled()
    expect(lease.canDetach()).toBe(false)
  })
})
