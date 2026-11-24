import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, RemoteSession } from '../src/types'

const hookHarness = vi.hoisted(() => {
  let cursor = 0
  let refSlots: Array<{ current: unknown } | undefined> = []
  let stateSlots: Array<{ value: unknown; setter: (next: unknown) => void } | undefined> = []
  let memoSlots: Array<{ deps?: readonly unknown[]; value: unknown } | undefined> = []
  let effectSlots: Array<{ deps?: readonly unknown[]; cleanup?: () => void } | undefined> = []
  let pendingEffects: Array<() => void> = []
  let pendingLayoutEffects: Array<() => void> = []
  let dirty = false

  const depsChanged = (prev?: readonly unknown[], next?: readonly unknown[]) =>
    prev === undefined
    || next === undefined
    || prev.length !== next.length
    || prev.some((dep, i) => !Object.is(dep, next[i]))

  const reset = () => {
    for (const slot of effectSlots) slot?.cleanup?.()
    cursor = 0
    refSlots = []
    stateSlots = []
    memoSlots = []
    effectSlots = []
    pendingEffects = []
    pendingLayoutEffects = []
    dirty = false
  }

  const runRender = <T,>(render: () => T): T => {
    cursor = 0
    dirty = false
    const result = render()
    const layouts = pendingLayoutEffects.splice(0)
    for (const fn of layouts) fn()
    const effects = pendingEffects.splice(0)
    for (const fn of effects) fn()
    return result
  }

  return {
    reset,
    runRender,
    isDirty: () => dirty,
    useRef<T>(initial: T): { current: T } {
      const idx = cursor++
      if (refSlots[idx] === undefined) refSlots[idx] = { current: initial }
      return refSlots[idx] as { current: T }
    },
    useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
      const idx = cursor++
      if (stateSlots[idx] === undefined) {
        const value = typeof initial === 'function' ? (initial as () => T)() : initial
        const slot = {
          value,
          setter: (next: unknown) => {
            const resolved = typeof next === 'function'
              ? (next as (prev: T) => T)(slot.value as T)
              : (next as T)
            if (!Object.is(slot.value, resolved)) {
              slot.value = resolved
              dirty = true
            }
          },
        }
        stateSlots[idx] = slot
      }
      const slot = stateSlots[idx]!
      return [slot.value as T, slot.setter as (next: T | ((prev: T) => T)) => void]
    },
    useMemo<T>(factory: () => T, deps?: readonly unknown[]): T {
      const idx = cursor++
      const prev = memoSlots[idx]
      if (prev === undefined || depsChanged(prev.deps, deps)) {
        const value = factory()
        memoSlots[idx] = { deps, value }
        return value
      }
      return prev.value as T
    },
    useCallback<T extends Function>(fn: T, deps?: readonly unknown[]): T {
      return hookHarness.useMemo(() => fn, deps)
    },
    useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void {
      const idx = cursor++
      const prev = effectSlots[idx]
      if (prev === undefined || depsChanged(prev.deps, deps)) {
        pendingLayoutEffects.push(() => {
          prev?.cleanup?.()
          const cleanup = effect()
          effectSlots[idx] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
        })
      }
    },
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void {
      const idx = cursor++
      const prev = effectSlots[idx]
      if (prev === undefined || depsChanged(prev.deps, deps)) {
        pendingEffects.push(() => {
          prev?.cleanup?.()
          const cleanup = effect()
          effectSlots[idx] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
        })
      }
    },
  }
})

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useRef: <T,>(initial: T) => hookHarness.useRef(initial),
    useState: <T,>(initial: T | (() => T)) => hookHarness.useState(initial),
    useMemo: <T,>(factory: () => T, deps?: readonly unknown[]) => hookHarness.useMemo(factory, deps),
    useCallback: <T extends Function>(fn: T, deps?: readonly unknown[]) => hookHarness.useCallback(fn, deps),
    useLayoutEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) =>
      hookHarness.useLayoutEffect(effect, deps),
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) =>
      hookHarness.useEffect(effect, deps),
  }
})

vi.mock('react-native', () => ({
  FlatList: {},
  Keyboard: { dismiss: vi.fn() },
}))

vi.mock('../src/services/browse-memory', () => {
  const entries: Record<string, { position?: { offset: number; atBottom: boolean; key?: string } }> = {}
  return {
    useBrowseMemory: { getState: () => ({ entries }) },
    updateBrowseEntry: vi.fn(),
  }
})

import { chatSections } from '../src/state/message-helpers'
import { TAIL_EXPAND_STEP, TAIL_WINDOW_SIZE, useChatScroll } from '../src/screens/chat/use-chat-scroll'

function makeSession(sessionId: string): RemoteSession {
  return { sessionId, backend: 'harness', updatedAt: 1_000, running: false, blank: false }
}

function makeMessages(sessionId: string, count: number): ChatItem[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: 'message' as const,
    id: `${sessionId}-m-${i}`,
    sessionId,
    createdAt: i * 100,
    role: 'user' as const,
    text: `Message ${i}`,
  }))
}

describe('useChatScroll progressive tail expansion state machine', () => {
  let nextRafId = 1
  const rafQueue = new Map<number, () => void>()
  const originalRaf = globalThis.requestAnimationFrame
  const originalCaf = globalThis.cancelAnimationFrame

  beforeEach(() => {
    vi.useFakeTimers()
    hookHarness.reset()
    nextRafId = 1
    rafQueue.clear()
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      const id = nextRafId++
      rafQueue.set(id, () => cb(Date.now()))
      return id
    }
    globalThis.cancelAnimationFrame = (id: number | null | undefined) => {
      if (typeof id === 'number') rafQueue.delete(id)
    }
  })

  afterEach(() => {
    hookHarness.reset()
    vi.useRealTimers()
    globalThis.requestAnimationFrame = originalRaf
    globalThis.cancelAnimationFrame = originalCaf
  })

  const flushRafs = () => {
    const callbacks = [...rafQueue.values()]
    rafQueue.clear()
    for (const cb of callbacks) cb()
  }

  const settle = <T,>(render: () => T): T => {
    let result = hookHarness.runRender(render)
    for (let guard = 0; guard < 6 && hookHarness.isDirty(); guard += 1) {
      result = hookHarness.runRender(render)
    }
    return result
  }

  it('keeps the queued immediate expansion rAF intact when anchorEnabled commits from false to true on drag', () => {
    const session = makeSession('sess-long-1')
    const messages = makeMessages(session.sessionId, 12)
    const visibleSections = chatSections(messages)
    const setTrajectory = vi.fn()
    const render = () => useChatScroll({
      session,
      messages,
      visibleMessages: messages,
      visibleSections,
      memoryScope: 'scope',
      memoryKey: `scope:${session.sessionId}`,
      panelOpen: false,
      historyLoadingOlder: false,
      busy: undefined,
      setTrajectory,
    })

    let state = settle(render)
    expect(state.displaySections).toHaveLength(TAIL_WINDOW_SIZE)
    expect(state.maintainVisibleContentPosition).toBeUndefined()

    // User drags within the initial 280ms delay: must arm anchoring on this commit
    // without cancelling the queued rAF that expands to all 12 sections on the next frame.
    state.onScrollBeginDrag()
    state = settle(render)
    expect(state.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 })
    expect(rafQueue.size).toBe(1)

    flushRafs()
    state = settle(render)
    expect(state.displaySections).toHaveLength(12)
    expect(state.displaySections).toBe(visibleSections)
  })

  it('advances the first background chunk right after 280ms + 1 rAF rather than losing the frame to cleanup', () => {
    const session = makeSession('sess-long-2')
    const messages = makeMessages(session.sessionId, 12)
    const visibleSections = chatSections(messages)
    const setTrajectory = vi.fn()
    const render = () => useChatScroll({
      session,
      messages,
      visibleMessages: messages,
      visibleSections,
      memoryScope: 'scope',
      memoryKey: `scope:${session.sessionId}`,
      panelOpen: false,
      historyLoadingOlder: false,
      busy: undefined,
      setTrajectory,
    })

    let state = settle(render)
    expect(state.displaySections).toHaveLength(TAIL_WINDOW_SIZE)

    vi.advanceTimersByTime(280)
    state = settle(render)
    expect(state.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 })
    expect(rafQueue.size).toBeGreaterThanOrEqual(1)

    flushRafs()
    state = settle(render)
    expect(state.displaySections).toHaveLength(TAIL_WINDOW_SIZE + TAIL_EXPAND_STEP)
  })

  it('cancels an in-flight tail expansion rAF when switching to another session', () => {
    let session = makeSession('sess-a')
    let messages = makeMessages(session.sessionId, 12)
    let visibleSections = chatSections(messages)
    const setTrajectory = vi.fn()
    const render = () => useChatScroll({
      session,
      messages,
      visibleMessages: messages,
      visibleSections,
      memoryScope: 'scope',
      memoryKey: `scope:${session.sessionId}`,
      panelOpen: false,
      historyLoadingOlder: false,
      busy: undefined,
      setTrajectory,
    })

    let state = settle(render)
    flushRafs()
    state.onScrollBeginDrag()
    state = settle(render)
    expect(rafQueue.size).toBe(1)
    const staleTailRafId = [...rafQueue.keys()][0]!

    // Switch session before the rAF fires: previous tail rAF must be cancelled and
    // new session starts cleanly sliced with anchoring disarmed even after scroll rAFs flush.
    session = makeSession('sess-b')
    messages = makeMessages(session.sessionId, 10)
    visibleSections = chatSections(messages)
    state = settle(render)
    expect(rafQueue.has(staleTailRafId)).toBe(false)
    flushRafs()
    state = settle(render)
    expect(state.displaySections).toHaveLength(TAIL_WINDOW_SIZE)
    expect(state.maintainVisibleContentPosition).toBeUndefined()
  })
})
