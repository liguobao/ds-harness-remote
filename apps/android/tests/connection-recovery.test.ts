import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { ForegroundConnectionRecovery } from '../src/services/connection-recovery'

type RecoveryState = ReturnType<ConstructorParameters<typeof ForegroundConnectionRecovery>[0]>

let state: RecoveryState
let recovery: ForegroundConnectionRecovery
let reconnect: ReturnType<typeof vi.fn<(options: { forceRelay?: boolean }) => Promise<boolean>>>
let exhausted: ReturnType<typeof vi.fn>

function prepare() {
  vi.clearAllTimers()
  vi.useFakeTimers()
  state = {
    connection: { phase: 'connected', stats: { mode: 'P2P' } },
    selectedDevice: { deviceId: 'host-1' }, reauthRequired: false, transportPreference: 'auto',
  }
  reconnect = vi.fn(async () => false)
  exhausted = vi.fn()
  recovery = new ForegroundConnectionRecovery(() => state, reconnect, exhausted)
  recovery.setActive(true)
}

function offline() {
  state = { ...state, connection: { phase: 'offline', stats: { mode: 'Disconnected' } } }
  recovery.update()
}

beforeEach(prepare)
afterEach(() => { recovery.setActive(false); vi.useRealTimers() })

describe('foreground carrier recovery', () => {
  it('bounds retries and preserves explicit transport choices', async () => {
    await runScenarios(['auto', 'turn', 'relay'].map(preference => ({ name: preference, run: async () => {
      state.transportPreference = preference as RecoveryState['transportPreference']
      offline()
      recovery.update()
      // First retry is immediate (0ms) so a dropped P2P path heals over the
      // relay without a fixed startup delay.
      await vi.advanceTimersByTimeAsync(0)
      expect(reconnect).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(reconnect).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(3_000)
      expect(reconnect).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(8_000)
      expect(reconnect).toHaveBeenCalledTimes(4)
      await vi.advanceTimersByTimeAsync(15_000 + 30_000 + 30_000 + 60_000)
      expect(reconnect).toHaveBeenCalledTimes(8)
      expect(exhausted).toHaveBeenCalledOnce()
      recovery.update()
      expect(exhausted).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(reconnect).toHaveBeenCalledTimes(8)
      expect(reconnect.mock.calls.map(([options]) => options)).toEqual(
        Array.from({ length: 8 }, () => preference === 'auto' ? { forceRelay: true } : {}),
      )
    } })), prepare)
  })

  it('cancels stale retries on lifecycle, identity and security transitions', async () => {
    await runScenarios(['background', 'disconnect', 'switch-host', 'reauth', 'refused', 'manual-connect', 'never-connected']
      .map(action => ({ name: action, run: async () => {
        if (action === 'never-connected') {
          state.connection.phase = 'disconnected'
          recovery.update()
        }
        offline()
        if (action === 'background') recovery.setActive(false)
        if (action === 'disconnect') state.connection.phase = 'disconnected'
        if (action === 'switch-host') state.selectedDevice = { deviceId: 'host-2' }
        if (action === 'reauth') state.reauthRequired = true
        if (action === 'refused') state.connection.retryable = false
        if (action === 'manual-connect') state.connection.phase = 'connecting'
        recovery.update()
        if (action === 'never-connected') {
          // A first attempt that never established retries twice immediately
          // over Relay and then gives up instead of hanging.
          await vi.advanceTimersByTimeAsync(0)
          expect(reconnect).toHaveBeenCalledTimes(1)
          expect(reconnect).toHaveBeenLastCalledWith({ forceRelay: true })
          await vi.advanceTimersByTimeAsync(1_000)
          expect(reconnect).toHaveBeenCalledTimes(2)
          await vi.advanceTimersByTimeAsync(300_000)
          expect(reconnect).toHaveBeenCalledTimes(2)
          expect(exhausted).toHaveBeenCalledOnce()
          return
        }
        await vi.advanceTimersByTimeAsync(30_000)
        expect(reconnect).not.toHaveBeenCalled()
        if (action === 'refused') expect(exhausted).toHaveBeenCalledOnce()
      } })), prepare)
  })

  it('allows only one recovery flight and rearms after a healthy connection', async () => {
    let finish!: (value: boolean) => void
    reconnect.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    offline()
    await vi.advanceTimersByTimeAsync(0)
    recovery.update()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(reconnect).toHaveBeenCalledOnce()
    state.connection = { phase: 'connected', stats: { mode: 'Relay' } }
    recovery.update()
    finish(true)
    await vi.advanceTimersByTimeAsync(0)
    offline()
    reconnect.mockImplementationOnce(async () => { throw new Error('unavailable') })
    await vi.advanceTimersByTimeAsync(0)
    expect(reconnect).toHaveBeenLastCalledWith({})
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reconnect).toHaveBeenLastCalledWith({ forceRelay: true })
    recovery.setActive(false)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(reconnect).toHaveBeenCalledTimes(3)
    // Returning to the foreground re-arms immediately, even after the
    // previous cycle was on its way through the backoff ladder.
    recovery.setActive(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(reconnect).toHaveBeenCalledTimes(4)
  })
})
