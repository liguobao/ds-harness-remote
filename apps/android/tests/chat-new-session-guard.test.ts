import { describe, expect, it, vi } from 'vitest'

describe('chat top-right new session reentrancy and blank session guard', () => {
  it('suppresses duplicate creations when currently in a blank session or rapid tapping', async () => {
    const createSessionMock = vi.fn(async (_workspaceId?: string) => true)
    const onNewSessionMock = vi.fn()
    const alertMock = vi.fn()

    let newSessionPending = false
    let busy: string | undefined = undefined
    const creatingSessionRef = { current: false }
    const lastNewSessionTimeRef = { current: 0 }

    const createStartNewSession = (visibleMessagesCount: number, isSessionBlank: boolean) => {
      return async (currentWorkspaceId?: string) => {
        const now = Date.now()
        if (now - lastNewSessionTimeRef.current < 800) return 'throttled'
        if (creatingSessionRef.current || newSessionPending || busy !== undefined) return 'busy'

        const isBlank = visibleMessagesCount === 0 && isSessionBlank !== false
        if (isBlank) {
          return 'reused_blank'
        }

        creatingSessionRef.current = true
        lastNewSessionTimeRef.current = now
        newSessionPending = true
        try {
          const created = await createSessionMock(currentWorkspaceId)
          if (created) {
            onNewSessionMock()
            return 'created'
          } else {
            alertMock()
            return 'failed'
          }
        } finally {
          creatingSessionRef.current = false
          newSessionPending = false
        }
      }
    }

    // Scenario 1: Already in an empty session (0 visible messages, blank)
    const onBlankSession = createStartNewSession(0, true)
    const blankResult = await onBlankSession('ws-1')
    expect(blankResult).toBe('reused_blank')
    expect(createSessionMock).not.toHaveBeenCalled()
    expect(onNewSessionMock).not.toHaveBeenCalled()

    // Scenario 1b: Existing conversation (blank: false) while messages are still loading (0 visible) -> allows creation
    lastNewSessionTimeRef.current = 0
    const onLoadingSession = createStartNewSession(0, false)
    const loadingResult = await onLoadingSession('ws-1')
    expect(loadingResult).toBe('created')
    expect(createSessionMock).toHaveBeenCalledTimes(1)
    expect(onNewSessionMock).toHaveBeenCalledTimes(1)

    // Scenario 2: Active conversation with messages -> triggers creation
    const onActiveSession = createStartNewSession(5, false)
    lastNewSessionTimeRef.current = 0 // reset time
    const activeResult = await onActiveSession('ws-1')
    expect(activeResult).toBe('created')
    expect(createSessionMock).toHaveBeenCalledTimes(2)
    expect(createSessionMock).toHaveBeenCalledWith('ws-1')
    expect(onNewSessionMock).toHaveBeenCalledTimes(2)

    // Scenario 3: Rapid second tap (< 800ms) is throttled and ignored
    const rapidResult = await onActiveSession('ws-1')
    expect(rapidResult).toBe('throttled')
    expect(createSessionMock).toHaveBeenCalledTimes(2) // still 2

    // Scenario 4: Concurrent invocation while in flight is blocked by ref lock
    lastNewSessionTimeRef.current = 0
    let resolveInFlight: (val: boolean) => void = () => {}
    createSessionMock.mockImplementationOnce(() => new Promise(resolve => { resolveInFlight = resolve }))

    const firstCallPromise = onActiveSession('ws-1')
    // Attempt concurrent second tap while first is in-flight
    lastNewSessionTimeRef.current = 0 // simulate time passed but first still running
    const secondCallPromise = onActiveSession('ws-1')

    expect(await secondCallPromise).toBe('busy')
    resolveInFlight!(true)
    expect(await firstCallPromise).toBe('created')
    expect(createSessionMock).toHaveBeenCalledTimes(3)

    // Scenario 5: Blocked when system busy
    busy = 'generating'
    lastNewSessionTimeRef.current = 0
    expect(await onActiveSession('ws-1')).toBe('busy')
    expect(createSessionMock).toHaveBeenCalledTimes(3)
  })

  it('drawer handleNewSession closes without spawning extra session if current session is blank in target workspace', async () => {
    const createSessionMock = vi.fn(async (_workspaceId?: string) => true)
    const onCloseMock = vi.fn()

    const creatingSessionRef = { current: false }
    const lastNewSessionTimeRef = { current: 0 }

    const runDrawerNewSession = async (
      targetWs: string | undefined,
      currentSession: { sessionId: string; blank?: boolean } | undefined,
      currentMessagesCount: number,
      currentWsId: string | undefined,
      connected: boolean,
    ) => {
      const now = Date.now()
      if (now - lastNewSessionTimeRef.current < 800) return 'throttled'
      if (creatingSessionRef.current || !connected) return 'blocked'

      const isCurrentBlank = currentSession !== undefined && currentMessagesCount === 0 && currentSession.blank !== false
      if (isCurrentBlank && (targetWs === undefined || currentWsId === targetWs)) {
        onCloseMock()
        return 'reused_and_closed'
      }

      creatingSessionRef.current = true
      lastNewSessionTimeRef.current = now
      try {
        const ok = await createSessionMock(targetWs)
        if (ok) onCloseMock()
        return 'created'
      } finally {
        creatingSessionRef.current = false
      }
    }

    // 1. Current session is already blank in target workspace -> close drawer, 0 RPCs
    const res1 = await runDrawerNewSession('ws-1', { sessionId: 's-blank', blank: true }, 0, 'ws-1', true)
    expect(res1).toBe('reused_and_closed')
    expect(createSessionMock).not.toHaveBeenCalled()
    expect(onCloseMock).toHaveBeenCalledTimes(1)

    // 2. Current session is in ws-1, but user targets ws-2 -> creates in ws-2
    lastNewSessionTimeRef.current = 0
    const res2 = await runDrawerNewSession('ws-2', { sessionId: 's-blank', blank: true }, 0, 'ws-1', true)
    expect(res2).toBe('created')
    expect(createSessionMock).toHaveBeenCalledWith('ws-2')
    expect(onCloseMock).toHaveBeenCalledTimes(2)
  })
})
