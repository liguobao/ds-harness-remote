import { useRef } from 'react'

export type GatedStoreHook<S> = {
  <T>(selector: (state: S) => T): T
  getState: () => S
}

export interface GatedSnapshotCache<T> {
  has: boolean
  value: T
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
  return useStore(state => selectGatedSnapshot(cacheRef.current, state, selector, active))
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
