import { describe, expect, it } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { initialData, selectCustomAcpBackends, type AppState } from '../src/state/store-state'

describe('customAcpBackends selector and initial state stability', () => {
  it('initializes customAcpBackends to an empty array in initialData()', () => {
    const state = initialData()
    expect(state.customAcpBackends).toEqual([])
  })

  it('returns a stable cached reference when customAcpBackends is undefined', () => {
    const missing: Pick<AppState, 'customAcpBackends'> = { customAcpBackends: undefined }
    const first = selectCustomAcpBackends(missing)
    const second = selectCustomAcpBackends(missing)

    expect(first).toEqual([])
    expect(Object.is(first, second)).toBe(true)
  })

  it('preserves snapshot identity across repeated Zustand getSnapshot reads', () => {
    const store = createStore<Pick<AppState, 'customAcpBackends'>>(() => ({
      customAcpBackends: initialData().customAcpBackends,
    }))
    const getSnapshot = () => selectCustomAcpBackends(store.getState())

    expect(Object.is(getSnapshot(), getSnapshot())).toBe(true)

    store.setState({ customAcpBackends: undefined })
    expect(getSnapshot()).toEqual([])
    expect(Object.is(getSnapshot(), getSnapshot())).toBe(true)

    const configured = ['custom-agent']
    store.setState({ customAcpBackends: configured })
    expect(Object.is(getSnapshot(), configured)).toBe(true)
    expect(Object.is(getSnapshot(), getSnapshot())).toBe(true)
  })
})
