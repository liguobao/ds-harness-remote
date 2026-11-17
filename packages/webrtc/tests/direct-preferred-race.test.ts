import { afterEach, expect, it, vi } from 'vitest'
import { DirectPreferredRace } from '../src/direct-preferred-race.js'
afterEach(() => vi.useRealTimers())
it('selects once, honors direct preference and bounds every wait', async () => {
  for (const scenario of ['direct-first', 'turn-first', 'direct-failed', 'window', 'late-turn', 'both-failed', 'deadline', 'cancel', 'standby-closed', 'late-direct'] as const) {
    vi.useFakeTimers()
    const abort = new AbortController()
    const race = new DirectPreferredRace<string>(abort.signal)
    let result: unknown
    const done = race.result.then(value => { result = value.attempt }, () => { result = 'failed' })
    if (scenario === 'direct-first') { race.ready('direct', 'd'); race.ready('turn', 't') }
    if (scenario === 'turn-first') { race.ready('turn', 't'); await vi.advanceTimersByTimeAsync(2999); expect(result, scenario).toBeUndefined(); race.ready('direct', 'd') }
    if (scenario === 'direct-failed') { race.ready('turn', 't'); race.failed('direct') }
    if (scenario === 'window') { race.ready('turn', 't'); await vi.advanceTimersByTimeAsync(3000) }
    if (scenario === 'late-turn') { await vi.advanceTimersByTimeAsync(4000); expect(result, scenario).toBeUndefined(); race.ready('turn', 't') }
    if (scenario === 'both-failed') { race.failed('turn'); race.failed('direct') }
    if (scenario === 'deadline') { await vi.advanceTimersByTimeAsync(12000); race.ready('direct', 'd') }
    if (scenario === 'cancel') { race.ready('turn', 't'); abort.abort(); race.ready('direct', 'd') }
    if (scenario === 'standby-closed') { race.ready('turn', 't'); race.failed('turn'); await vi.advanceTimersByTimeAsync(3000); expect(result, scenario).toBeUndefined(); race.ready('direct', 'd') }
    if (scenario === 'late-direct') { await vi.advanceTimersByTimeAsync(4000); race.ready('direct', 'd') }
    await done
    const expected = ['direct-first', 'turn-first', 'standby-closed', 'late-direct'].includes(scenario) ? 'direct'
      : ['direct-failed', 'window', 'late-turn'].includes(scenario) ? 'turn' : 'failed'
    expect(result, scenario).toBe(expected)
    expect(vi.getTimerCount(), scenario).toBe(0)
    vi.useRealTimers()
  }
})

it('starts the preference window at RTC negotiation while bounding stalled setup', async () => {
  for (const scenario of ['delayed-start', 'stalled-with-turn', 'stalled-without-turn'] as const) {
    vi.useFakeTimers()
    const race = new DirectPreferredRace<string>(new AbortController().signal, 3000, 25000, true)
    let result: unknown
    const done = race.result.then(value => { result = value.attempt }, () => { result = 'failed' })
    if (scenario !== 'stalled-without-turn') race.ready('turn', 't')
    await vi.advanceTimersByTimeAsync(10000)
    expect(result, scenario).toBeUndefined()
    if (scenario === 'delayed-start') {
      race.startWindow()
      await vi.advanceTimersByTimeAsync(2999)
      expect(result).toBeUndefined()
      race.startWindow() // Duplicate startup notifications cannot extend the window.
      await vi.advanceTimersByTimeAsync(1)
    } else {
      await vi.advanceTimersByTimeAsync(15000)
    }
    await done
    expect(result, scenario).toBe(scenario === 'stalled-without-turn' ? 'failed' : 'turn')
    expect(vi.getTimerCount(), scenario).toBe(0)
    vi.useRealTimers()
  }
})


it('extends only for a newly started configured attempt and never resets the priority window', async () => {
  vi.useFakeTimers()
  const race = new DirectPreferredRace<string>(new AbortController().signal, 3000, 25000, true)
  let result: unknown
  const done = race.result.then(value => { result = value.attempt }, () => { result = 'failed' })
  await vi.advanceTimersByTimeAsync(7000)
  race.startAttempt('direct', 30000)
  race.startAttempt('turn', 30000)
  await vi.advanceTimersByTimeAsync(29999)
  expect(result).toBeUndefined()
  race.startAttempt('turn', 30000) // Late duplicate cannot keep the race alive.
  await vi.advanceTimersByTimeAsync(1)
  await done
  expect(result).toBe('failed')
  expect(vi.getTimerCount()).toBe(0)
})
