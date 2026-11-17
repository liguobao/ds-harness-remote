import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
}

export function useChatScroll({ session, messages, visibleMessages, visibleSections, memoryScope, memoryKey, panelOpen, historyLoadingOlder, busy, setTrajectory }: Options) {
  const sessionId = session?.sessionId
  const listRef = useRef<FlatList<ChatSection>>(null)
  const lastAutoScrollAt = useRef(0)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
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
  const autoScrollAllowedRef = useRef(false)
  autoScrollAllowedRef.current = !panelOpen && !historyLoadingOlder && sessionId !== undefined && visibleMessages.length > 0

  const cancelPendingScroll = useCallback(() => {
    hasTrailingScrollRef.current = false
    pendingScrollStreakRef.current = 0
    if (scrollTimerRef.current !== null) clearTimeout(scrollTimerRef.current)
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current)
    scrollTimerRef.current = null
    scrollFrameRef.current = null
  }, [])

  // Follow measured content and viewport changes (including the keyboard).
  // Keep a trailing command so the last streaming measurement is never lost,
  // while coalescing high-frequency deltas (~30 Hz) with no React state updates.
  const scheduleScrollToBottom = useCallback(() => {
    if (!pinToBottomRef.current && !initialPinRef.current) return
    if (userScrollingRef.current) return

    if (scrollTimerRef.current !== null || scrollFrameRef.current !== null) {
      hasTrailingScrollRef.current = true
      return
    }

    const runScroll = () => {
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null
        if (!autoScrollAllowedRef.current || userScrollingRef.current
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
  }, [])

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

  // Restore reading position before the new list can emit scroll events.
  useLayoutEffect(() => {
    scrollIntentGenerationRef.current++
    cancelPendingScroll()
    setTrajectory(false)
    savedPosition.current = useBrowseMemory.getState().entries[memoryKey]?.position
    const bottom = savedPosition.current?.atBottom !== false
    pinToBottomRef.current = bottom
    initialPinRef.current = bottom
    restoringPosition.current = !bottom
    setNewContent(false)
    laidOutSessionRef.current = undefined
    userScrollingRef.current = false
    listViewportRef.current = { width: 0, height: 0 }
    listContentRef.current = { width: 0, height: 0 }
    listOffsetRef.current = 0
    awayFromLatestRef.current = !bottom
    setAwayFromLatest(!bottom)
  }, [memoryKey, cancelPendingScroll])

  useEffect(() => cancelPendingScroll, [cancelPendingScroll])

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
    if (panelOpen || visibleMessages.length === 0 || historyLoadingOlder || sessionId === undefined) return
    if (!pinToBottomRef.current && !initialPinRef.current) return
    const timer = setTimeout(() => {
      if (pinToBottomRef.current || initialPinRef.current) scheduleScrollToBottom()
    }, 32)
    return () => clearTimeout(timer)
  }, [historyLoadingOlder, panelOpen, scheduleScrollToBottom, sessionId, visibleMessages.length])

  // Loading older history prepends above the viewport — do not yank to the end.
  useEffect(() => {
    if (!historyLoadingOlder) return
    pinToBottomRef.current = false
    initialPinRef.current = false
  }, [historyLoadingOlder])

  // Streaming deltas keep the same item id, but update text length / reasoning.
  // Compute a cheap signature of the last item so streaming increments trigger auto-scroll.
  const streamingSignature = useMemo(() => computeStreamingSignature(visibleMessages), [visibleMessages])

  // Scroll when a brand-new item is appended or the last message receives streaming tokens.
  useEffect(() => {
    if (panelOpen || visibleMessages.length === 0 || historyLoadingOlder || sessionId === undefined) return
    if (!pinToBottomRef.current && !initialPinRef.current) return
    scheduleScrollToBottom()
  }, [streamingSignature, visibleMessages.length, historyLoadingOlder, panelOpen, scheduleScrollToBottom, sessionId])

  const onListLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    const previous = listViewportRef.current
    if (previous.width === width && previous.height === height) return
    listViewportRef.current = { width, height }
    // The viewport can change while the content stays put (keyboard, rotation,
    // tablet split), which is exactly when the newest turn may leave the screen.
    syncLatestTurnIndicator(listContentRef.current.height - height - listOffsetRef.current)
    if (!autoScrollAllowedRef.current || (!pinToBottomRef.current && !initialPinRef.current)) return
    scheduleScrollToBottom()
  }, [scheduleScrollToBottom, syncLatestTurnIndicator])

  const onListContentSizeChange = useCallback((width: number, height: number) => {
    const previous = listContentRef.current
    if (previous.width === width && previous.height === height) return
    listContentRef.current = { width, height }
    syncLatestTurnIndicator(height - listViewportRef.current.height - listOffsetRef.current)
    if (!autoScrollAllowedRef.current || (!pinToBottomRef.current && !initialPinRef.current)) return
    scheduleScrollToBottom()
  }, [scheduleScrollToBottom, syncLatestTurnIndicator])

  const restoreReadingPosition = useCallback(() => {
    // A session switch can render the list before its viewport and markdown
    // rows have measured. Defer one extra frame so the initial jump reaches
    // the actual end rather than the pre-layout content height.
    if (panelOpen || visibleMessages.length === 0 || historyLoadingOlder || sessionId === undefined) return
    if (laidOutSessionRef.current === sessionId) return
    const position = savedPosition.current
    const anchorIndex = visibleSections.findIndex(item => item.key === position?.key)
    if (position?.atBottom === false && anchorIndex < 0 && busy?.startsWith('session:')) return
    laidOutSessionRef.current = sessionId
    if (position?.atBottom === false) {
      requestAnimationFrame(() => {
        if (anchorIndex >= 0) listRef.current?.scrollToIndex({ index: anchorIndex, animated: false, viewPosition: 0 })
        else listRef.current?.scrollToOffset({ offset: position.key === undefined ? position.offset : 0, animated: false })
        restoringPosition.current = false
      })
    } else scheduleScrollToBottom()
  }, [historyLoadingOlder, panelOpen, scheduleScrollToBottom, sessionId, visibleMessages.length, visibleSections, busy])
  useEffect(() => { restoreReadingPosition() }, [restoreReadingPosition])

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
    if (session !== undefined && (Date.now() - lastPositionSave.current > 200 || atBottom)) {
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

  const onScrollBeginDrag = () => {
    scrollIntentGenerationRef.current++
    cancelPendingScroll()
    userScrollingRef.current = true
    Keyboard.dismiss()
  }
  const onMomentumScrollBegin = () => {
    cancelPendingScroll()
    userScrollingRef.current = true
  }
  return {
    listRef, viewability, awayFromLatest, newContent, jumpToLatest, beginSendScroll,
    onListLayout, onListContentSizeChange, onListScroll, onListDragEnd, onListMomentumEnd,
    onScrollBeginDrag, onMomentumScrollBegin
  }
}

function visibleMessageVersion(items: ChatItem[]): string {
  const last = items[items.length - 1]
  return last === undefined ? '' : JSON.stringify(last)
}
