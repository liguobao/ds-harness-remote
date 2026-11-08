import { afterEach, describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import type { AppState, StoreAccess } from '../src/state/store-state'
import type { SessionRuntime } from '../src/state/session-runtime'

const storage = vi.hoisted(() => ({ saveTransportPreference: vi.fn(async () => {}) }))
vi.mock('../src/services/storage', () => storage)
vi.mock('../src/locales/i18n', () => ({ applyLanguagePreference: vi.fn(), updateSystemLocales: vi.fn() }))
import { createPreferenceActions } from '../src/state/preference-actions'

afterEach(() => vi.restoreAllMocks())

describe('explicit transport selection', () => {
  it('clears automatic downgrade and retires an active attempt before reconnecting', async () => {
    await runScenarios((['connected', 'connecting', 'reconnecting', 'offline', 'disconnected'] as const).flatMap(phase =>
      (['auto', 'turn', 'relay'] as const).map(preference => ({ name: `${phase} -> ${preference}`, run: async () => {
        storage.saveTransportPreference.mockClear()
        const active = ['connected', 'connecting', 'reconnecting'].includes(phase)
        const runtime = {
          webRtcFallbackStreak: 2,
          connectionGeneration: 4,
          sessionLoadGeneration: 8,
          reconnectFlight: Promise.resolve(false),
        } as SessionRuntime
        const reconnect = vi.fn(async () => {
          expect(state.transportPreference).toBe(preference)
          expect(state.relayOnlyUntil).toBeUndefined()
          expect(state.connection.phase).toBe('offline')
          expect(runtime.webRtcFallbackStreak).toBe(0)
          expect(runtime.connectionGeneration).toBe(5)
          expect(runtime.reconnectFlight).toBeUndefined()
          return true
        })
        let state = {
          transportPreference: preference, // Reselecting the current mode must also retry it.
          relayOnlyUntil: Date.now() + 600_000,
          connection: { phase, stats: { mode: 'Relay', connected: phase === 'connected' } },
          reconnect,
        } as unknown as AppState
        const access: StoreAccess = {
          get: () => state,
          set: partial => { state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) } },
        }
        const actions = createPreferenceActions({ ...access, runtime })
        await actions.setTransportPreference(preference)
        expect(storage.saveTransportPreference).toHaveBeenCalledWith(preference)
        expect(state.relayOnlyUntil).toBeUndefined()
        expect(runtime.webRtcFallbackStreak).toBe(0)
        expect(reconnect).toHaveBeenCalledTimes(active ? 1 : 0)
        expect(runtime.connectionGeneration).toBe(active ? 5 : 4)
        expect(runtime.sessionLoadGeneration).toBe(active ? 9 : 8)
      } }))),
    )
  })
})
