import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import { FlatList, Keyboard, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { updateBrowseEntry, useBrowseMemory } from '../../services/browse-memory'
import { computeStreamingSignature, LATEST_EDGE_PX, type ChatSection } from '../../state/message-helpers'
import type { ChatItem, RemoteSession } from '../../types'

type Options = {
  session: RemoteSession | undefined
  messages: ChatItem[]
  visibleMessages: ChatItem[]
  visibleSections: readonly ChatSection[]
  memoryScope: string
  memoryKey: string
  panelOpen: boolean
  historyLoadingOlder: boolean
  busy: string | undefined
  setTrajectory: (value: boolean) => void
  drawerOpenRef?: RefObject<boolean>
  cancelScrollRef?: MutableRefObject<(() => void) | undefined>
  onDrawerClosedRef?: MutableRefObject<(() => void) | undefined>
}

const MAINTAIN_VISIBLE_POSITION = { minIndexForVisible: 0 } as const
export const TAIL_WINDOW_SIZE = 3
export const TAIL_EXPAND_STEP = 3
const TAIL_EXPAND_DELAY_MS = 280
const TAIL_EXPAND_STEP_MS = 120

/**
 * Slice a bottom-aligned transcript to its latest turns on the initial frame of
 * a session switch; short transcripts (`<= tailLimit + 1`) stay intact.
 */
export function resolveDisplaySections(
  sections: readonly ChatSection[],
  tailLimit: number | undefined,
): readonly ChatSection[] {
  if (tailLimit === undefined || tailLimit <= 0 || sections.length <= tailLimit + 1) {
    return sections
  }
  return sections.slice(-tailLimit)
}

/** Advance the progressive tail limit one chunk at a time until all sections fit. */
export function nextTailWindowLimit(
  currentLimit: number | undefined,
  totalSections: number,
  step = TAIL_EXPAND_STEP,
): number | undefined {
  if (currentLimit === undefined || currentLimit <= 0) return undefined
  const next = currentLimit + Math.max(1, step)
  return totalSections <= next + 1 ? undefined : next
}

function savedAtBottomFor(memoryKey: string): boolean {
  return useBrowseMemory.getState().entries[memoryKey]?.position?.atBottom !== false
}

export function useChatScroll({
  session,
  messages,
  visibleMessages,
  visibleSections,
  memoryScope,
  memoryKey,
  panelOpen,
  historyLoadingOlder,
  busy,
  setTrajectory,
  drawerOpenRef,
  cancelScrollRef,
  onDrawerClosedRef,
}: Options) {
  const sessionId = session?.sessionId
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const memoryKeyRef = useRef(memoryKey)
  memoryKeyRef.current = memoryKey
  const listRef = useRef<FlatList<ChatSection>>(null)
  const lastAutoScrollAt = useRef(0)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const tailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tailFrameRef = useRef<number | null>(null)
  const listViewportRef = useRef({ width: 0, height: 0 })
  const listContentRef = useRef({ width: 0, height: 0 })
  const userScrollingRef = useRef(false)
  const hasTrailingScrollRef = useRef(false)
  const pendingScrollStreakRef = useRef(0)
  const scrollIntentGenerationRef = useRef(0)
  /** Keep the viewport on the latest turn until the user scrolls away. */
  const pinToBottomRef = useRef(true)
  /** Re-pin while the first session layout (markdown / images) is still settling. */
  const initialPinRef = useRef(true)
  const [newContent, setNewContent] = useState(false)
  const [windowState, setWindowState] = useState<{
    key: string
    tailLimit: number | undefined
    anchorEnabled: boolean
  }>(() => ({
    key: memoryKey,
    tailLimit: savedAtBottomFor(memoryKey) ? TAIL_WINDOW_SIZE : undefined,
    anchorEnabled: false,
  }))
  const isFreshSessionRender = windowState.key !== memoryKey
  const effectiveTailLimit = isFreshSessionRender
    ? (savedAtBottomFor(memoryKey) ? TAIL_WINDOW_SIZE : undefined)
    : windowState.tailLimit
  const effectiveAnchorEnabled = isFreshSessionRender
    ? false
    : (windowState.anchorEnabled || historyLoadingOlder)
  const displaySections = useMemo(
    () => resolveDisplaySections(visibleSections, effectiveTailLimit),
    [visibleSections, effectiveTailLimit],
  )
  const maintainVisibleContentPosition = effectiveAnchorEnabled ? MAINTAIN_VISIBLE_POSITION : undefined
  const tailLimitRef = useRef(effectiveTailLimit)
  tailLimitRef.current = effectiveTailLimit
  const totalSectionsRef = useRef(visibleSections.length)
  totalSectionsRef.current = visibleSections.length
  const isTailSlicedRef = useRef(displaySections.length < visibleSections.length)
  isTailSlicedRef.current = displaySections.length < visibleSections.length
  const visibleAnchor = useRef<string | undefined>(undefined)
  const laidOutSessionRef = useRef<string | undefined>(undefined)
  const restoringPosition = useRef(false)
  const savedPosition = useRef(useBrowseMemory.getState().entries[memoryKey]?.position)
  const lastPositionSave = useRef(0)
  const lastContentVersion = useMemo(() => visibleMessageVersion(messages), [messages])
  const contentBefore = useRef<{ key: string; version?: string }>({ key: memoryKey })
  const viewability = useRef(({ viewableItems }: { viewableItems: Array<{ key: string }> }) => {
    visibleAnchor.current = viewableItems[0]?.key
  }).current
  /** Last reported scroll offset; content and viewport changes re-check the latest turn from it. */
  const listOffsetRef = useRef(0)
  /** Mirrors the floating jump button so scroll events only re-render on a crossing. */
  const awayFromLatestRef = useRef(false)
  const [awayFromLatest, setAwayFromLatest] = useState(false)
  const baseAutoScrollAllowedRef = useRef(false)
  baseAutoScrollAllowedRef.current = !panelOpen && !historyLoadingOlder && sessionId !== undefined && visibleMessages.length > 0
  const autoScrollAllowedRef = useRef(false)
  autoScrollAllowedRef.current = baseAutoScrollAllowedRef.current && !drawerOpenRef?.current
  const isAutoScrollAllowed = useCallback(
    () => baseAutoScrollAllowedRef.current && !drawerOpenRef?.current,
    [drawerOpenRef],
  )

  const cancelPendingScroll = useCallback(() => {
    hasTrailingScrollRef.current = false
    pendingScrollStreakRef.current = 0
    if (scrollTimerRef.current !== null) clearTimeout(scrollTimerRef.current)
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
    scrollTimerRef.current = null
    scrollFrameRef.current = null
  }, [])

  const clearTailTimer = useCallback(() => {
    if (tailTimerRef.current !== null) {
      clearTimeout(tailTimerRef.current)
      tailTimerRef.current = null
    }
  }, [])

  const cancelTailExpansion = useCallback(() => {
    clearTailTimer()
    if (tailFrameRef.current !== null) {
      cancelAnimationFrame(tailFrameRef.current)
      tailFrameRef.current = null
    }
  }, [clearTailTimer])

  const expandTailWindow = useCallback((immediate = false) => {
    if (tailLimitRef.current === undefined) return
    if (tailTimerRef.current !== null) {
      clearTimeout(tailTimerRef.current)
      tailTimerRef.current = null
    }
    if (tailFrameRef.current !== null) {
      if (!immediate) return
      cancelAnimationFrame(tailFrameRef.current)
      tailFrameRef.current = null
    }
    const activeKey = memoryKeyRef.current
    if (!isTailSlicedRef.current) {
      setWindowState(prev => (prev.key !== activeKey || prev.tailLimit === undefined ? prev : { ...prev, tailLimit: undefined }))
      return
    }
    const advanceLimit = (prev: { key: string; tailLimit: number | undefined; anchorEnabled: boolean }) => {
      if (prev.key !== activeKey || prev.tailLimit === undefined) return prev
      const nextLimit = immediate ? undefined : nextTailWindowLimit(prev.tailLimit, totalSectionsRef.current)
      return prev.tailLimit === nextLimit ? prev : { ...prev, tailLimit: nextLimit }
    }
    // Arm `maintainVisibleContentPosition` one frame before prepending earlier
    // turns so Android's MaintainVisibleScrollPositionHelper is mounted first.
    setWindowState(prev => {
      if (prev.key !== activeKey || prev.tailLimit === undefined || prev.anchorEnabled) return prev
      return { ...prev, anchorEnabled: true }
    })
    tailFrameRef.current = requestAnimationFrame(() => {
      tailFrameRef.current = null
      setWindowState(advanceLimit)
    })
  }, [])

  // Follow measured content and viewport changes (including the keyboard).
  // Keep a trailing command so the last streaming measurement is never lost,
  // while coalescing high-frequency deltas (~30 Hz) with no React state updates.
  const scheduleScrollToBottom = useCallback(() => {
    if (drawerOpenRef?.current) return
    if (!pinToBottomRef.current && !initialPinRef.current) return
    if (userScrollingRef.current) return

    if (scrollTimerRef.current !== null || scrollFrameRef.current !== null) {
      hasTrailingScrollRef.current = true
      return
    }

    const runScroll = () => {
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null
        if (!isAutoScrollAllowed() || userScrollingRef.current
          || (!pinToBottomRef.current && !initialPinRef.current)) {
          hasTrailingScrollRef.current = false
          pendingScrollStreakRef.current = 0
          return
        }
        lastAutoScrollAt.current = Date.now()
        // Nonanimated commands also keep native momentum callbacks reserved
        // for user flings, so they cannot disable following during a reply.
        listRef.current?.scrollToEnd({ animated: false })

        if (hasTrailingScrollRef.current && pendingScrollStreakRef.current < 2) {
          hasTrailingScrollRef.current = false
          pendingScrollStreakRef.current += 1
          scheduleScrollToBottom()
        } else {
          hasTrailingScrollRef.current = false
          pendingScrollStreakRef.current = 0
        }
      })
    }

    const elapsed = Date.now() - lastAutoScrollAt.current
    const delay = Math.max(0, 33 - elapsed)
    if (delay === 0) {
      runScroll()
    } else {
      scrollTimerRef.current = setTimeout(() => {
        scrollTimerRef.current = null
        runScroll()
      }, delay)
    }
  }, [drawerOpenRef, isAutoScrollAllowed])

  // Following the latest turn is suspended once the user scrolls away, so the
  // floating button is the only way back without a manual fling. It follows
  // measured metrics rather than a gesture, so an older history page loading
  // above, a window resize or a running reply also re-check it.
  const syncLatestTurnIndicator = useCallback((distanceFromEnd: number) => {
    const away = !pinToBottomRef.current && !initialPinRef.current && distanceFromEnd > LATEST_EDGE_PX
    if (awayFromLatestRef.current === away) return
    awayFromLatestRef.current = away
    setAwayFromLatest(away)
  }, [])

  // Re-enable follow mode before jumping, so a reply that streams in right
  // after the tap keeps appending at the end. The queued follow pass also
  // re-asserts the end once the rows below finish re-measuring, which a single
  // scroll command cannot guarantee on a virtualized list.
  const jumpToLatest = useCallback(() => {
    scrollIntentGenerationRef.current++
    cancelPendingScroll()
    userScrollingRef.current = false
    pinToBottomRef.current = true
    initialPinRef.current = true
    awayFromLatestRef.current = false
    setAwayFromLatest(false)
    setNewContent(false)
    restoringPosition.current = false
    if (session !== undefined) {
      updateBrowseEntry(memoryScope, session.sessionId, {
        position: { offset: 0, atBottom: true }, seenAt: session.updatedAt,
      })
    }
    listRef.current?.scrollToEnd({ animated: false })
    scheduleScrollToBottom()
  }, [cancelPendingScroll, scheduleScrollToBottom, memoryScope, session?.sessionId, session?.updatedAt])

  // Restore reading position before the reused list can emit scroll events.
  // Keep `listViewportRef` intact because the FlatList no longer remounts on
  // session switch, so `onLayout` will not re-fire for the same viewport size.
  useLayoutEffect(() => {
    scrollIntentGenerationRef.current++
    cancelPendingScroll()
    cancelTailExpansion()
    setTrajectory(false)
    savedPosition.current = useBrowseMemory.getState().entries[memoryKey]?.position
    const bottom = savedPosition.current?.atBottom !== false
    pinToBottomRef.current = bottom
    initialPinRef.current = bottom
    restoringPosition.current = !bottom
    visibleAnchor.current = undefined
    setNewContent(false)
    laidOutSessionRef.current = undefined
    userScrollingRef.current = false
    listContentRef.current = { width: 0, height: 0 }
    listOffsetRef.current = 0
    listRef.current?.scrollToOffset({ offset: 0, animated: false })
    awayFromLatestRef.current = !bottom
    setAwayFromLatest(!bottom)
    const initialTailLimit = bottom ? TAIL_WINDOW_SIZE : undefined
    setWindowState(prev =>
      prev.key === memoryKey && prev.tailLimit === initialTailLimit && !prev.anchorEnabled
        ? prev
        : { key: memoryKey, tailLimit: initialTailLimit, anchorEnabled: false },
    )
  }, [memoryKey, cancelPendingScroll, cancelTailExpansion, setTrajectory])

  useEffect(() => {
    if (windowState.key !== memoryKey || windowState.tailLimit === undefined) return
    const delayMs = windowState.tailLimit === TAIL_WINDOW_SIZE
      ? TAIL_EXPAND_DELAY_MS
      : TAIL_EXPAND_STEP_MS
    tailTimerRef.current = setTimeout(() => {
      tailTimerRef.current = null
      expandTailWindow(false)
    }, delayMs)
    return clearTailTimer
  }, [memoryKey, windowState.key, windowState.tailLimit, expandTailWindow, clearTailTimer])

  useEffect(() => () => {
    cancelPendingScroll()
    cancelTailExpansion()
  }, [cancelPendingScroll, cancelTailExpansion])

  // A sheet or picker owns the user's next touch. Cancel a queued list jump
  // as soon as it opens so a streaming update cannot move the responder under
  // the panel.
  useEffect(() => {
    if (panelOpen) cancelPendingScroll()
  }, [panelOpen, cancelPendingScroll])

  // Let the first layout frame finish before jumping to the end. This keeps
  // the top bar and Android back dispatch responsive while a large history
  // page is being mounted, without relying on the deprecated InteractionManager.
  useEffect(() => {
    if (panelOpen || drawerOpenRef?.current || visibleMessages.length === 0 || historyLoadingOlder || sessionId === undefined) return
    if (!pinToBottomRef.current && !initialPinRef.current) return
    const timer = setTimeout(() => {
      if (!drawerOpenRef?.current && (pinToBottomRef.current || initialPinRef.current)) scheduleScrollToBottom()
    }, 32)
    return () => clearTimeout(timer)
  }, [drawerOpenRef, historyLoadingOlder, panelOpen, scheduleScrollToBottom, sessionId, visibleMessages.length])

  // Loading older history prepends above the viewport — do not yank to the end,
  // and keep position anchoring enabled until the next session switch.
  useEffect(() => {
    if (!historyLoadingOlder) return
    pinToBottomRef.current = false
    initialPinRef.current = false
    const activeKey = memoryKeyRef.current
    setWindowState(prev =>
      prev.key === activeKey && prev.anchorEnabled
        ? prev
        : { key: activeKey, tailLimit: prev.key === activeKey ? prev.tailLimit : undefined, anchorEnabled: true },
    )
    if (tailLimitRef.current !== undefined) expandTailWindow(true)
  }, [historyLoadingOlder, expandTailWindow])

  // Streaming deltas keep the same item id, but update text length / reasoning.
  // Compute a cheap signature of the last item so streaming increments trigger auto-scroll.
  const streamingSignature = useMemo(() => computeStreamingSignature(visibleMessages), [visibleMessages])

  // Scroll when a brand-new item is appended or the last message receives streaming tokens.
  useEffect(() => {
    if (panelOpen || drawerOpenRef?.current || visibleMessages.length === 0 || historyLoadingOlder || sessionId === undefined) return
    if (!pinToBottomRef.current && !initialPinRef.current) return
    scheduleScrollToBottom()
  }, [drawerOpenRef, streamingSignature, visibleMessages.length, historyLoadingOlder, panelOpen, scheduleScrollToBottom, sessionId])

  const onListLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    const previous = listViewportRef.current
    if (previous.width === width && previous.height === height) return
    listViewportRef.current = { width, height }
    // The viewport can change while the content stays put (keyboard, rotation,
    // tablet split), which is exactly when the newest turn may leave the screen.
    syncLatestTurnIndicator(listContentRef.current.height - height - listOffsetRef.current)
    if (!isAutoScrollAllowed() || (!pinToBottomRef.current && !initialPinRef.current)) return
    scheduleScrollToBottom()
  }, [isAutoScrollAllowed, scheduleScrollToBottom, syncLatestTurnIndicator])

  const onListContentSizeChange = useCallback((width: number, height: number) => {
    const previous = listContentRef.current
    if (previous.width === width && previous.height === height) return
    listContentRef.current = { width, height }
    syncLatestTurnIndicator(height - listViewportRef.current.height - listOffsetRef.current)
    if (!isAutoScrollAllowed() || (!pinToBottomRef.current && !initialPinRef.current)) return
    scheduleScrollToBottom()
  }, [isAutoScrollAllowed, scheduleScrollToBottom, syncLatestTurnIndicator])

  const restoreReadingPosition = useCallback(() => {
    // A session switch can render the list before its viewport and markdown
    // rows have measured. Defer one extra frame so the initial jump reaches
    // the actual end rather than the pre-layout content height.
    if (panelOpen || drawerOpenRef?.current || visibleMessages.length === 0 || historyLoadingOlder || sessionId === undefined) return
    if (laidOutSessionRef.current === sessionId) return
    const position = savedPosition.current
    const anchorIndex = displaySections.findIndex(item => item.key === position?.key)
    if (position?.atBottom === false && anchorIndex < 0 && busy?.startsWith('session:')) return
    laidOutSessionRef.current = sessionId
    if (position?.atBottom === false) {
      requestAnimationFrame(() => {
        if (drawerOpenRef?.current || sessionIdRef.current !== sessionId) {
          if (sessionIdRef.current === sessionId) laidOutSessionRef.current = undefined
          return
        }
        if (anchorIndex >= 0) listRef.current?.scrollToIndex({ index: anchorIndex, animated: false, viewPosition: 0 })
        else listRef.current?.scrollToOffset({ offset: position.key === undefined ? position.offset : 0, animated: false })
        restoringPosition.current = false
      })
    } else scheduleScrollToBottom()
  }, [drawerOpenRef, historyLoadingOlder, panelOpen, scheduleScrollToBottom, sessionId, visibleMessages.length, displaySections, busy])
  useEffect(() => { restoreReadingPosition() }, [restoreReadingPosition])

  const restoreReadingPositionRef = useRef(restoreReadingPosition)
  restoreReadingPositionRef.current = restoreReadingPosition

  useEffect(() => {
    if (cancelScrollRef !== undefined) {
      cancelScrollRef.current = cancelPendingScroll
    }
    if (onDrawerClosedRef !== undefined) {
      onDrawerClosedRef.current = () => {
        if (drawerOpenRef?.current) return
        const wasLaidOut = laidOutSessionRef.current === sessionIdRef.current
        restoreReadingPositionRef.current()
        if (wasLaidOut && (pinToBottomRef.current || initialPinRef.current)) {
          scheduleScrollToBottom()
        }
      }
    }
    return () => {
      if (cancelScrollRef !== undefined) cancelScrollRef.current = undefined
      if (onDrawerClosedRef !== undefined) onDrawerClosedRef.current = undefined
    }
  }, [cancelScrollRef, onDrawerClosedRef, cancelPendingScroll, drawerOpenRef, scheduleScrollToBottom])

  const onListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    listOffsetRef.current = contentOffset.y
    const distanceFromEnd = contentSize.height - layoutMeasurement.height - contentOffset.y
    // Content growth and IME resizing can also emit scroll events. Only a
    // user's drag/fling changes the intent to follow the latest response.
    if (restoringPosition.current) {
      syncLatestTurnIndicator(distanceFromEnd)
      return
    }
    const atBottom = distanceFromEnd <= LATEST_EDGE_PX
    if (userScrollingRef.current) {
      if (distanceFromEnd > LATEST_EDGE_PX) {
        pinToBottomRef.current = false
        initialPinRef.current = false
      } else {
        pinToBottomRef.current = true
      }
    } else if (atBottom) {
      pinToBottomRef.current = true
      initialPinRef.current = false
    }
    syncLatestTurnIndicator(distanceFromEnd)
    if (atBottom) setNewContent(false)
    // Ignore the synthetic offset-0 event emitted while resetting the reused
    // list before the initial bottom pin lands.
    const shouldSavePosition = atBottom || !initialPinRef.current || userScrollingRef.current
    if (session !== undefined && shouldSavePosition && (Date.now() - lastPositionSave.current > 200 || atBottom)) {
      lastPositionSave.current = Date.now()
      updateBrowseEntry(memoryScope, session.sessionId, {        
position: { key: visibleAnchor.current, offset: contentOffset.y, atBottom },
        ...(atBottom ? { seenAt: session.updatedAt } : {})      
})
    }
  }, [memoryScope, session?.sessionId, session?.updatedAt, syncLatestTurnIndicator])
  useEffect(() => {
    if (contentBefore.current.key === memoryKey && contentBefore.current.version !== undefined
      && contentBefore.current.version !== lastContentVersion && !pinToBottomRef.current) setNewContent(true)
    contentBefore.current = { key: memoryKey, version: lastContentVersion }
  }, [lastContentVersion, memoryKey])

  const finishListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    userScrollingRef.current = false
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    const distanceFromEnd = contentSize.height - layoutMeasurement.height - contentOffset.y
    if (distanceFromEnd <= LATEST_EDGE_PX) {
      pinToBottomRef.current = true
      initialPinRef.current = false
      scheduleScrollToBottom()
    }
  }, [onListScroll, scheduleScrollToBottom])

  const onListDragEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    onListScroll(event)
    const velocityY = Math.abs(event.nativeEvent.velocity?.y ?? 0)
    if (velocityY <= 0.05) {
      finishListScroll(event)
    }
  }, [onListScroll, finishListScroll])

  const onListMomentumEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    onListScroll(event)
    finishListScroll(event)
  }, [onListScroll, finishListScroll])

  const beginSendScroll = () => {
    const generation = ++scrollIntentGenerationRef.current
    const previousPin = pinToBottomRef.current
    const previousInitialPin = initialPinRef.current
    const previousAway = awayFromLatestRef.current
    pinToBottomRef.current = true
    initialPinRef.current = true
    pendingScrollStreakRef.current = 0
    awayFromLatestRef.current = false
    setAwayFromLatest(false)
    setNewContent(false)
    scheduleScrollToBottom()
    return () => {
      if (scrollIntentGenerationRef.current !== generation) return
      cancelPendingScroll()
      pinToBottomRef.current = previousPin
      initialPinRef.current = previousInitialPin
      awayFromLatestRef.current = previousAway
      setAwayFromLatest(previousAway)
      if (previousPin || previousInitialPin) scheduleScrollToBottom()
    }
  }

  const onScrollBeginDrag = useCallback(() => {
    scrollIntentGenerationRef.current++
    cancelPendingScroll()
    userScrollingRef.current = true
    expandTailWindow(true)
    Keyboard.dismiss()
  }, [cancelPendingScroll, expandTailWindow])
  const onMomentumScrollBegin = useCallback(() => {
    cancelPendingScroll()
    userScrollingRef.current = true
  }, [cancelPendingScroll])
  return {
    listRef, displaySections, maintainVisibleContentPosition, viewability, awayFromLatest, newContent,
    jumpToLatest, beginSendScroll, onListLayout, onListContentSizeChange, onListScroll,
    onListDragEnd, onListMomentumEnd, onScrollBeginDrag, onMomentumScrollBegin,
  }
}

function visibleMessageVersion(items: ChatItem[]): string {
  // Streaming appends grow the last item's text/reasoning on every ~100ms flush.
  // A cheap length-based signature keeps this O(1) instead of re-serializing the
  // whole item (O(N²) over one long turn) on the JS thread during streaming.
  return computeStreamingSignature(items)
}
