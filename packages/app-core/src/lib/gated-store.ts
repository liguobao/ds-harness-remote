import { useCallback, useRef, useSyncExternalStore } from 'react'

export type GatedStoreHook<S> = {
  <T>(selector: (state: S) => T): T
  getState: () => S
  subscribe?: (listener: (state: S, prevState: S) => void) => () => void
}

export type SubscribableStore<S> = {
  getState: () => S
  subscribe: (listener: (state: S, prevState: S) => void) => () => void
}

export interface GatedSnapshotCache<T> {
  has: boolean
  value: T
}

export interface StoreGate {
  isActive: () => boolean
  setActive: (next: boolean) => void
  markDirty: () => void
  subscribe: (listener: () => void) => () => void
}

/**
 * Imperative subscription gate shared across a persistent off-screen subtree
 * (e.g. overlay sessions drawer):
 * - Deactivating (`setActive(false)`) emits 0 notifications so closing the
 *   drawer triggers 0 re-renders in the memoized drawer body.
 * - Background store writes while inactive mark the gate dirty without waking
 *   React subscribers.
 * - Reactivating (`setActive(true)`) flushes listeners synchronously in one
 *   tick only when dirty, keeping every subscriber on the exact same store
 *   snapshot (tear-free under React 19 `useSyncExternalStore`).
 */
export function createStoreGate(initialActive = true): StoreGate {
  let active = initialActive
  let dirty = false
  const listeners = new Set<() => void>()
  return {
    isActive: () => active,
    markDirty: () => {
      if (!active) dirty = true
    },
    setActive: (next: boolean) => {
      if (active === next) return
      active = next
      if (active && dirty) {
        dirty = false
        for (const listener of Array.from(listeners)) {
          listener()
        }
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * Pure snapshot gate for Zustand + React 19 `useSyncExternalStore`:
 * - First read always initializes the cache from `selector(state)` (even when inactive).
 * - While `active === false`, returns the exact cached reference so `Object.is` stays true
 *   and background store updates trigger 0 re-renders in hidden persistent subtrees.
 * - When `active === true`, reads fresh state and updates the cache.
 */
export function selectGatedSnapshot<S, T>(
  cache: GatedSnapshotCache<T>,
  state: S,
  selector: (state: S) => T,
  active: boolean,
): T {
  if (!active && cache.has) {
    return cache.value
  }
  const next = selector(state)
  if (cache.has && Object.is(cache.value, next)) {
    return cache.value
  }
  cache.value = next
  cache.has = true
  return next
}

export function useGatedStore<S, T>(
  useStore: GatedStoreHook<S>,
  selector: (state: S) => T,
  active: boolean,
): T {
  const cacheRef = useRef<GatedSnapshotCache<T>>({ has: false, value: undefined as T })
  const selectorRef = useRef(selector)
  selectorRef.current = selector
  return useStore(state => selectGatedSnapshot(cacheRef.current, state, selectorRef.current, active))
}

export function useStoreGateSelector<S, T>(
  useStore: SubscribableStore<S>,
  selector: (state: S) => T,
  gate: StoreGate,
): T {
  const cacheRef = useRef<GatedSnapshotCache<T>>({ has: false, value: undefined as T })
  const selectorRef = useRef(selector)
  selectorRef.current = selector

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const unsubStore = useStore.subscribe(() => {
        if (gate.isActive()) {
          onStoreChange()
        } else {
          gate.markDirty()
        }
      })
      const unsubGate = gate.subscribe(onStoreChange)
      // Store writes occurring between initial render and passive-effect
      // subscription cannot hit `unsubStore` yet; mark dirty while inactive so
      // the first activation checks the latest snapshot (zero re-render if equal).
      if (!gate.isActive()) {
        gate.markDirty()
      }
      return () => {
        unsubStore()
        unsubGate()
      }
    },
    [useStore, gate],
  )
  const getSnapshot = useCallback(
    () => selectGatedSnapshot(cacheRef.current, useStore.getState(), selectorRef.current, gate.isActive()),
    [useStore, gate],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function shouldAllowDrawerClose(params: {
  inline: boolean
  open: boolean
  closing: boolean
  dismissible: boolean
  force: boolean
}): boolean {
  if (!params.inline && !params.open) return false
  if (params.closing) return false
  if (!params.inline && !params.force && !params.dismissible) return false
  return true
}
