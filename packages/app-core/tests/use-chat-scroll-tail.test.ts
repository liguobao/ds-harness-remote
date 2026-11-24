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
import { updateBrowseEntry } from '../src/services/browse-memory'
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

  it('expands incrementally by TAIL_EXPAND_STEP on top-edge drag with 1-frame anchor handshake instead of dumping all history', () => {
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

    // No blind post-switch timer should silently dump earlier history while idle.
    vi.advanceTimersByTime(1_000)
    state = settle(render)
    expect(state.displaySections).toHaveLength(TAIL_WINDOW_SIZE)

    // Dragging near the top edge (offset 0) arms anchoring first and prepends
    // one bounded chunk on the next rAF rather than dumping all 12 sections.
    state.onScrollBeginDrag()
    state = settle(render)
    expect(state.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 })
    expect(rafQueue.size).toBe(1)

    flushRafs()
    state = settle(render)
    expect(state.displaySections).toHaveLength(TAIL_WINDOW_SIZE + TAIL_EXPAND_STEP)
  })

  it('fills a short tail slice one row at a time after drawer closes even when flexGrow keeps contentHeight equal to viewportHeight', () => {
    const session = makeSession('sess-short-tail')
    const messages = makeMessages(session.sessionId, 10)
    const visibleSections = chatSections(messages)
    const setTrajectory = vi.fn()
    const drawerOpenRef = { current: true }
    const onDrawerClosedRef: { current: (() => void) | undefined } = { current: undefined }
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
      drawerOpenRef,
      onDrawerClosedRef,
    })

    let state = settle(render)
    state.onListLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 411, height: 800 } } } as never)
    state.onListContentSizeChange(411, 800)
    // While drawer covers the list, short-tail fill must stay dormant.
    vi.advanceTimersByTime(500)
    state = settle(render)
    expect(state.displaySections).toHaveLength(TAIL_WINDOW_SIZE)

    // Once drawer closes, short-tail fill pulls 1 row after settle delay.
    drawerOpenRef.current = false
    onDrawerClosedRef.current?.()
    vi.advanceTimersByTime(200)
    state = settle(render)
    flushRafs()
    state = settle(render)
    expect(state.displaySections).toHaveLength(TAIL_WINDOW_SIZE + 1)

    // Even without a second onContentSizeChange (flexGrow keeps height === 800),
    // the next step still runs until content exceeds viewport + buffer.
    vi.advanceTimersByTime(200)
    state = settle(render)
    flushRafs()
    state = settle(render)
    expect(state.displaySections).toHaveLength(TAIL_WINDOW_SIZE + 2)

    // Once content grows past viewport + margin, auto-fill stops cleanly.
    state.onListContentSizeChange(411, 1100)
    vi.advanceTimersByTime(500)
    flushRafs()
    state = settle(render)
    expect(state.displaySections).toHaveLength(TAIL_WINDOW_SIZE + 2)
  })

  it('does not poison browseMemory with atBottom:false on programmatic content-growth scroll while bottom-pinned', () => {
    vi.mocked(updateBrowseEntry).mockClear()
    const session = makeSession('sess-pin-guard')
    const messages = makeMessages(session.sessionId, 8)
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

    const state = settle(render)
    // First land at the bottom so `initialPinRef` clears while `pinToBottomRef` stays true.
    state.onListScroll({
      nativeEvent: {
        contentOffset: { x: 0, y: 400 },
        contentSize: { width: 411, height: 1200 },
        layoutMeasurement: { width: 411, height: 800 },
      },
    } as never)
    vi.mocked(updateBrowseEntry).mockClear()
    vi.advanceTimersByTime(300)

    // Now content grows from 1200 -> 2400 while offset stays at 400 before scrollToEnd lands.
    state.onListScroll({
      nativeEvent: {
        contentOffset: { x: 0, y: 400 },
        contentSize: { width: 411, height: 2400 },
        layoutMeasurement: { width: 411, height: 800 },
      },
    } as never)
    expect(updateBrowseEntry).not.toHaveBeenCalled()
  })

  it('expands the tail window on non-drag upward scroll (mouse wheel/keyboard/TalkBack) and preserves top row when new turns append', () => {
    const session = makeSession('sess-wheel-and-append')
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
    state = settle(render)
    expect(state.displaySections).toHaveLength(TAIL_WINDOW_SIZE)

    // Settle at bottom first (`y = 600, contentSize = 1400, viewport = 800`).
    state.onListScroll({
      nativeEvent: {
        contentOffset: { x: 0, y: 600 },
        contentSize: { width: 411, height: 1400 },
        layoutMeasurement: { width: 411, height: 800 },
      },
    } as never)

    // Mouse wheel / TalkBack scrolls upward without emitting onScrollBeginDrag.
    state.onListScroll({
      nativeEvent: {
        contentOffset: { x: 0, y: 480 },
        contentSize: { width: 411, height: 1400 },
        layoutMeasurement: { width: 411, height: 800 },
      },
    } as never)
    state = settle(render)
    flushRafs()
    state = settle(render)
    expect(state.displaySections).toHaveLength(TAIL_WINDOW_SIZE + TAIL_EXPAND_STEP)
    const firstMountedKeyBeforeAppend = state.displaySections[0]!.key

    // While user is reading inside the sliced window, a new turn appends at the bottom.
    // The first mounted row must remain mounted rather than being evicted by `slice(-N)`.
    messages = [
      ...messages,
      {
        kind: 'message',
        id: 'msg-appended',
        sessionId: session.sessionId,
        createdAt: 99_999,
        role: 'assistant',
        text: 'Appended live turn',
      },
    ]
    visibleSections = chatSections(messages)
    state = settle(render)
    expect(state.displaySections[0]!.key).toBe(firstMountedKeyBeforeAppend)
    expect(state.displaySections).toHaveLength(TAIL_WINDOW_SIZE + TAIL_EXPAND_STEP + 1)
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
