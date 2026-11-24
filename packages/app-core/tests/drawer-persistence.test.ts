import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import type { RefObject } from 'react'
import type { TextInput } from 'react-native'

const harness = vi.hoisted(() => {
  let backListener: (() => boolean) | undefined
  const removeSpy = vi.fn(() => {
    backListener = undefined
  })
  const addEventListenerSpy = vi.fn((_event: string, listener: () => boolean) => {
    backListener = listener
    return { remove: removeSpy }
  })
  const keyboardDismissSpy = vi.fn()

  // Minimal stateful hook slots so tests can drive real hooks across re-renders.
  let hookCursor = 0
  let refSlots: Array<{ current: unknown } | undefined> = []
  let callbackSlots: Array<{ fn: unknown; deps?: readonly unknown[] } | undefined> = []
  let effectSlots: Array<{ deps?: readonly unknown[]; cleanup?: () => void } | undefined> = []
  let externalStoreSlots: Array<{
    subscribe: (onStoreChange: () => void) => () => void
    getSnapshot: () => unknown
    lastSnapshot: unknown
    cleanup?: () => void
    onForceRender?: () => void
    subscribed: boolean
  } | undefined> = []
  let onExternalStoreNotify: (() => void) | undefined

  const resetHooks = () => {
    for (const slot of effectSlots) {
      slot?.cleanup?.()
    }
    for (const slot of externalStoreSlots) {
      slot?.cleanup?.()
    }
    hookCursor = 0
    refSlots = []
    callbackSlots = []
    effectSlots = []
    externalStoreSlots = []
    onExternalStoreNotify = undefined
  }

  const beginRender = () => {
    hookCursor = 0
  }

  const flushExternalStoreSubscriptions = () => {
    for (const slot of externalStoreSlots) {
      if (slot === undefined || slot.subscribed) continue
      slot.subscribed = true
      slot.cleanup = slot.subscribe(() => {
        const next = slot.getSnapshot()
        if (!Object.is(slot.lastSnapshot, next)) {
          slot.lastSnapshot = next
          slot.onForceRender?.()
        }
      })
      const postSub = slot.getSnapshot()
      if (!Object.is(slot.lastSnapshot, postSub)) {
        slot.lastSnapshot = postSub
        slot.onForceRender?.()
      }
    }
  }

  return {
    get backListener() {
      return backListener
    },
    addEventListenerSpy,
    removeSpy,
    keyboardDismissSpy,
    resetHooks,
    beginRender,
    flushExternalStoreSubscriptions,
    setExternalStoreNotify(fn: (() => void) | undefined) {
      onExternalStoreNotify = fn
    },
    useRef<T>(initial: T): { current: T } {
      const idx = hookCursor++
      if (refSlots[idx] === undefined) {
        refSlots[idx] = { current: initial }
      }
      return refSlots[idx] as { current: T }
    },
    useCallback<T extends (...args: never[]) => unknown>(fn: T, deps?: readonly unknown[]): T {
      const idx = hookCursor++
      const prev = callbackSlots[idx]
      const unchanged = prev !== undefined
        && deps !== undefined
        && prev.deps !== undefined
        && deps.length === prev.deps.length
        && deps.every((dep, i) => Object.is(dep, prev.deps![i]))
      if (unchanged) return prev.fn as T
      callbackSlots[idx] = { fn, deps }
      return fn
    },
    useSyncExternalStore<T>(
      subscribe: (onStoreChange: () => void) => () => void,
      getSnapshot: () => T,
    ): T {
      const idx = hookCursor++
      const snapshot = getSnapshot()
      const existing = externalStoreSlots[idx]
      if (existing === undefined) {
        externalStoreSlots[idx] = {
          subscribe,
          getSnapshot,
          lastSnapshot: snapshot,
          onForceRender: onExternalStoreNotify,
          subscribed: false,
        }
      } else {
        existing.getSnapshot = getSnapshot
        existing.lastSnapshot = snapshot
        existing.onForceRender = onExternalStoreNotify
        if (existing.subscribe !== subscribe) {
          existing.cleanup?.()
          existing.subscribe = subscribe
          existing.subscribed = false
        }
      }
      return snapshot
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void {
      const idx = hookCursor++
      const prev = effectSlots[idx]
      const changed =
        prev === undefined
        || deps === undefined
        || prev.deps === undefined
        || deps.length !== prev.deps.length
        || deps.some((dep, i) => !Object.is(dep, prev.deps![i]))
      if (changed) {
        prev?.cleanup?.()
        const cleanup = effect()
        effectSlots[idx] = {
          deps,
          cleanup: typeof cleanup === 'function' ? cleanup : undefined,
        }
      }
    },
  }
})

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useRef: <T,>(initial: T) => harness.useRef(initial),
    useCallback: <T extends (...args: never[]) => unknown>(fn: T, deps?: readonly unknown[]) =>
      harness.useCallback(fn, deps),
    useSyncExternalStore: <T,>(
      subscribe: (onStoreChange: () => void) => () => void,
      getSnapshot: () => T,
    ) => harness.useSyncExternalStore(subscribe, getSnapshot),
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) =>
      harness.useEffect(effect, deps),
  }
})

vi.mock('react-native', () => ({
  BackHandler: {
    addEventListener: harness.addEventListenerSpy,
  },
  Keyboard: {
    dismiss: harness.keyboardDismissSpy,
  },
}))

import {
  createStoreGate,
  selectGatedSnapshot,
  shouldAllowDrawerClose,
  useGatedStore,
  useStoreGateSelector,
  type GatedSnapshotCache,
  type GatedStoreHook,
} from '../src/lib/gated-store'
import { useChatBackHandler } from '../src/screens/chat/use-chat-back-handler'

interface DemoStoreState {
  deviceId: string | undefined
  selectedSessionId: string
  streamTick: number
  sessions: Array<{ id: string; title: string }>
}

describe('gated store snapshot freezing for persistent hidden drawer', () => {
  beforeEach(() => {
    harness.resetHooks()
  })

  it('initializes snapshot even when first read is inactive, freezes while hidden, and syncs on reopen', () => {
    const cache: GatedSnapshotCache<DemoStoreState['sessions']> = {
      has: false,
      value: undefined as unknown as DemoStoreState['sessions'],
    }
    const selector = vi.fn((state: DemoStoreState) => state.sessions)

    const initialSessions = [{ id: 's1', title: 'Session 1' }]
    const state1: DemoStoreState = {
      deviceId: 'host-1',
      selectedSessionId: 's1',
      streamTick: 0,
      sessions: initialSessions,
    }

    // First read while inactive must still populate the cache.
    const snap1 = selectGatedSnapshot(cache, state1, selector, false)
    expect(snap1).toBe(initialSessions)
    expect(selector).toHaveBeenCalledTimes(1)

    // Subsequent reads while inactive return the exact cached reference without invoking selector.
    const state2: DemoStoreState = {
      ...state1,
      streamTick: 1,
      sessions: [{ id: 's1', title: 'Session 1 (streaming)' }, { id: 's2', title: 'Session 2' }],
    }
    const snap2 = selectGatedSnapshot(cache, state2, selector, false)
    expect(Object.is(snap2, initialSessions)).toBe(true)
    expect(selector).toHaveBeenCalledTimes(1)

    // Turning active immediately synchronizes the latest state in a single read.
    const snap3 = selectGatedSnapshot(cache, state2, selector, true)
    expect(snap3).toBe(state2.sessions)
    expect(selector).toHaveBeenCalledTimes(2)

    // Turning inactive again freezes on the latest synchronized snapshot.
    const state3: DemoStoreState = {
      ...state2,
      streamTick: 2,
      sessions: [{ id: 's3', title: 'Session 3' }],
    }
    const snap4 = selectGatedSnapshot(cache, state3, selector, false)
    expect(Object.is(snap4, state2.sessions)).toBe(true)
    expect(selector).toHaveBeenCalledTimes(2)
  })

  it('keeps undefined initial values frozen while hidden instead of treating undefined as uninitialized', () => {
    const cache: GatedSnapshotCache<string | undefined> = { has: false, value: undefined }
    const selector = vi.fn((state: DemoStoreState) => state.deviceId)

    const emptyState: DemoStoreState = {
      deviceId: undefined,
      selectedSessionId: '',
      streamTick: 0,
      sessions: [],
    }
    expect(selectGatedSnapshot(cache, emptyState, selector, false)).toBeUndefined()
    expect(cache.has).toBe(true)
    expect(selector).toHaveBeenCalledTimes(1)

    const populatedState: DemoStoreState = { ...emptyState, deviceId: 'host-2' }
    expect(selectGatedSnapshot(cache, populatedState, selector, false)).toBeUndefined()
    expect(selector).toHaveBeenCalledTimes(1)

    expect(selectGatedSnapshot(cache, populatedState, selector, true)).toBe('host-2')
    expect(selector).toHaveBeenCalledTimes(2)
  })

  it('triggers zero re-renders in a Zustand subscriber during streaming/session switches while hidden', () => {
    const store = createStore<DemoStoreState>(() => ({
      deviceId: 'host-1',
      selectedSessionId: 's1',
      streamTick: 0,
      sessions: [{ id: 's1', title: 'Initial' }],
    }))

    // Simulate React 19 useSyncExternalStore selector subscription driven by Zustand.
    let activeSelector: ((state: DemoStoreState) => unknown) | undefined
    let lastSnapshot: unknown
    let renderCount = 0
    let currentActive = true

    const boundUseStore: GatedStoreHook<DemoStoreState> = Object.assign(
      <T,>(selector: (state: DemoStoreState) => T): T => {
        activeSelector = selector as (state: DemoStoreState) => unknown
        const snapshot = selector(store.getState())
        // Verify React 19 getSnapshot idempotency requirement.
        expect(Object.is(selector(store.getState()), snapshot)).toBe(true)
        lastSnapshot = snapshot
        return snapshot
      },
      { getState: store.getState },
    )

    const renderComponent = (active: boolean) => {
      currentActive = active
      renderCount += 1
      harness.beginRender()
      return useGatedStore(boundUseStore, state => state.sessions, active)
    }

    const unsubscribe = store.subscribe(nextState => {
      if (activeSelector === undefined) return
      const nextSnapshot = activeSelector(nextState)
      if (!Object.is(lastSnapshot, nextSnapshot)) {
        renderComponent(currentActive)
      }
    })

    try {
      // Mount visible: 1 initial render.
      const first = renderComponent(true)
      expect(first).toEqual([{ id: 's1', title: 'Initial' }])
      expect(renderCount).toBe(1)

      // Streaming while visible triggers re-renders as expected.
      store.setState({ streamTick: 1, sessions: [{ id: 's1', title: 'Tick 1' }] })
      expect(renderCount).toBe(2)

      // Hide drawer: 1 render to switch active -> false.
      const frozen = renderComponent(false)
      expect(frozen).toEqual([{ id: 's1', title: 'Tick 1' }])
      expect(renderCount).toBe(3)

      // Simulate high-frequency streaming and openSession updates while drawer is hidden.
      for (let tick = 2; tick <= 12; tick += 1) {
        store.setState({
          selectedSessionId: tick % 2 === 0 ? 's2' : 's1',
          streamTick: tick,
          sessions: [{ id: 's1', title: `Tick ${tick}` }, { id: 's2', title: `Other ${tick}` }],
        })
      }
      expect(renderCount).toBe(3)

      // Reopen drawer: single render catches up to latest store snapshot.
      const reopened = renderComponent(true)
      expect(renderCount).toBe(4)
      expect(reopened).toEqual([{ id: 's1', title: 'Tick 12' }, { id: 's2', title: 'Other 12' }])
    } finally {
      unsubscribe()
    }
  })
})

describe('useChatBackHandler beforePanels priority', () => {
  beforeEach(() => {
    harness.resetHooks()
    harness.addEventListenerSpy.mockClear()
    harness.removeSpy.mockClear()
    harness.keyboardDismissSpy.mockClear()
  })

  function makeInputRef(focused: boolean): RefObject<TextInput | null> {
    return {
      current: { isFocused: () => focused } as unknown as TextInput,
    }
  }

  it('gives beforePanels (open drawer) strict priority over underlying open panels and focused input', () => {
    const inputRef = makeInputRef(true)
    const closeWorkspacePicker = vi.fn()
    const closeTrajectory = vi.fn()
    const onBack = vi.fn(() => true)
    const drawerBack = vi.fn(() => true)

    let drawerOpen = true
    let workspacePickerOpen = true
    let trajectoryOpen = true

    const renderHook = (active = true) => {
      harness.beginRender()
      useChatBackHandler(
        inputRef,
        onBack,
        [
          { open: workspacePickerOpen, close: () => { workspacePickerOpen = false; closeWorkspacePicker() } },
          { open: trajectoryOpen, close: () => { trajectoryOpen = false; closeTrajectory() } },
        ],
        active,
        () => (drawerOpen ? drawerBack() : false),
      )
    }

    renderHook(true)
    expect(harness.addEventListenerSpy).toHaveBeenCalledTimes(1)
    expect(harness.backListener).toBeDefined()

    // While drawer is open, back closes the drawer and never touches underlying panels or keyboard.
    expect(harness.backListener!()).toBe(true)
    expect(drawerBack).toHaveBeenCalledTimes(1)
    expect(closeWorkspacePicker).not.toHaveBeenCalled()
    expect(closeTrajectory).not.toHaveBeenCalled()
    expect(harness.keyboardDismissSpy).not.toHaveBeenCalled()
    expect(onBack).not.toHaveBeenCalled()

    // Once drawer is closed (even without re-rendering ChatConversationPane), original priority resumes.
    drawerOpen = false
    expect(harness.backListener!()).toBe(true)
    expect(closeWorkspacePicker).toHaveBeenCalledTimes(1)
    expect(closeTrajectory).not.toHaveBeenCalled()

    renderHook(true)
    expect(harness.backListener!()).toBe(true)
    expect(closeTrajectory).toHaveBeenCalledTimes(1)

    renderHook(true)
    // Now no panels are open, focused input dismisses keyboard first.
    expect(harness.backListener!()).toBe(true)
    expect(harness.keyboardDismissSpy).toHaveBeenCalledTimes(1)
    expect(onBack).not.toHaveBeenCalled()

    // With input unfocused, falls through to onBack.
    ;(inputRef as { current: unknown }).current = { isFocused: () => false }
    expect(harness.backListener!()).toBe(true)
    expect(onBack).toHaveBeenCalledTimes(1)

    // Listener was never re-subscribed across re-renders, and cleans up on unmount.
    expect(harness.addEventListenerSpy).toHaveBeenCalledTimes(1)
    harness.resetHooks()
    expect(harness.removeSpy).toHaveBeenCalledTimes(1)
  })

  it('ignores hardware back completely when active is false and stays backward-compatible without beforePanels', () => {
    const inputRef = makeInputRef(false)
    const closePanel = vi.fn()
    const onBack = vi.fn(() => true)
    const beforePanels = vi.fn(() => true)

    harness.beginRender()
    useChatBackHandler(inputRef, onBack, [{ open: true, close: closePanel }], false, beforePanels)

    expect(harness.backListener!()).toBe(false)
    expect(beforePanels).not.toHaveBeenCalled()
    expect(closePanel).not.toHaveBeenCalled()
    expect(onBack).not.toHaveBeenCalled()

    // Omitting beforePanels preserves legacy panel -> onBack behavior.
    harness.beginRender()
    useChatBackHandler(inputRef, onBack, [{ open: true, close: closePanel }], true)
    expect(harness.backListener!()).toBe(true)
    expect(closePanel).toHaveBeenCalledTimes(1)
    expect(onBack).not.toHaveBeenCalled()
  })
})

describe('drawer close contract across cold-start, hidden, and re-entry states', () => {
  it('blocks non-forced close when dismissible is false on cold start, but allows forced close (tapping active session)', () => {
    // Cold start parked drawer: swipe/backdrop/back (force=false) must be rejected.
    expect(shouldAllowDrawerClose({
      inline: false,
      open: true,
      closing: false,
      dismissible: false,
      force: false,
    })).toBe(false)

    // Tapping the already-selected session unlocks and uses force=true for smooth close.
    expect(shouldAllowDrawerClose({
      inline: false,
      open: true,
      closing: false,
      dismissible: false,
      force: true,
    })).toBe(true)
  })

  it('blocks close when overlay drawer is already hidden or mid-exit animation', () => {
    expect(shouldAllowDrawerClose({
      inline: false,
      open: false,
      closing: false,
      dismissible: true,
      force: false,
    })).toBe(false)

    expect(shouldAllowDrawerClose({
      inline: false,
      open: false,
      closing: false,
      dismissible: true,
      force: true,
    })).toBe(false)

    expect(shouldAllowDrawerClose({
      inline: false,
      open: true,
      closing: true,
      dismissible: true,
      force: true,
    })).toBe(false)
  })

  it('allows normal close once unlocked and reopened, and allows inline close when not closing', () => {
    expect(shouldAllowDrawerClose({
      inline: false,
      open: true,
      closing: false,
      dismissible: true,
      force: false,
    })).toBe(true)

    expect(shouldAllowDrawerClose({
      inline: true,
      open: false,
      closing: false,
      dismissible: false,
      force: false,
    })).toBe(true)

    expect(shouldAllowDrawerClose({
      inline: true,
      open: true,
      closing: true,
      dismissible: true,
      force: true,
    })).toBe(false)
  })
})

describe('StoreGate zero-notify freeze and synchronized reopen', () => {
  it('emits zero notifications when freezing or reopening without changes, and notifies once on reopen when dirty', () => {
    const gate = createStoreGate(true)
    const listener = vi.fn()
    const unsubscribe = gate.subscribe(listener)

    try {
      expect(gate.isActive()).toBe(true)

      // Closing the drawer freezes subscribers with zero notifications.
      gate.setActive(false)
      expect(gate.isActive()).toBe(false)
      expect(listener).not.toHaveBeenCalled()

      // Reopening with no underlying store changes notifies zero times.
      gate.setActive(true)
      expect(gate.isActive()).toBe(true)
      expect(listener).not.toHaveBeenCalled()

      // Closing again, marking dirty while frozen, then reopening flushes once.
      gate.setActive(false)
      gate.markDirty()
      gate.markDirty()
      expect(listener).not.toHaveBeenCalled()

      gate.setActive(true)
      expect(listener).toHaveBeenCalledTimes(1)

      // Subsequent redundant setActive(true) does not re-notify.
      gate.setActive(true)
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribe()
    }
  })

  it('useStoreGateSelector freezes background writes, flushes once on reopen, and catches writes before initial passive subscribe', () => {
    harness.resetHooks()
    const store = createStore<DemoStoreState>(() => ({
      deviceId: 'host-1',
      selectedSessionId: 's1',
      streamTick: 0,
      sessions: [{ id: 's1', title: 'Initial' }],
    }))
    const gate = createStoreGate(false)
    let renderCount = 0
    let latestSessions: Array<{ id: string; title: string }> = []

    const render = () => {
      renderCount += 1
      harness.beginRender()
      latestSessions = useStoreGateSelector(store, state => state.sessions, gate)
      return latestSessions
    }

    harness.setExternalStoreNotify(() => {
      render()
    })

    // 1. Mount closed: renders initial snapshot before passive subscription attaches.
    expect(render()).toEqual([{ id: 's1', title: 'Initial' }])
    expect(renderCount).toBe(1)

    // 2. Store mutates in the window between initial render and passive-effect subscribe.
    store.setState({ sessions: [{ id: 's1', title: 'Updated Before Subscribe' }] })
    harness.flushExternalStoreSubscriptions()
    expect(renderCount).toBe(1)

    // 3. First open must see the write from step 2 rather than stale initial cache.
    gate.setActive(true)
    expect(renderCount).toBe(2)
    expect(latestSessions).toEqual([{ id: 's1', title: 'Updated Before Subscribe' }])

    // 4. Closing freezes subscriptions with 0 re-renders; background writes trigger 0 renders.
    gate.setActive(false)
    expect(renderCount).toBe(2)
    for (let tick = 1; tick <= 5; tick += 1) {
      store.setState({
        streamTick: tick,
        sessions: [{ id: 's1', title: `Tick ${tick}` }],
      })
    }
    expect(renderCount).toBe(2)
    expect(latestSessions).toEqual([{ id: 's1', title: 'Updated Before Subscribe' }])

    // 5. Reopening flushes once with the latest snapshot.
    gate.setActive(true)
    expect(renderCount).toBe(3)
    expect(latestSessions).toEqual([{ id: 's1', title: 'Tick 5' }])

    // 6. Close + reopen without store changes triggers 0 extra renders.
    gate.setActive(false)
    gate.setActive(true)
    expect(renderCount).toBe(3)
  })
})
