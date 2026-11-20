import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexThreadLifecycle } from '../src/codex/thread-lifecycle.js'

afterEach(() => vi.useRealTimers())

describe('CodexThreadLifecycle recovery', () => {
  it('fails closed after an unconfirmed unload without replaying a new request', async () => {
    vi.useFakeTimers()
    const unsubscribe = vi.fn(async () => ({ status: 'unsubscribed' }))
    const failed = vi.fn()
    const lifecycle = new CodexThreadLifecycle(() => false, unsubscribe, () => undefined, failed, 100)
    const closing = lifecycle.release('thread')
    await vi.advanceTimersByTimeAsync(100)
    await closing
    expect(failed).toHaveBeenCalledOnce()
    const action = vi.fn(async () => 'sent')
    await expect(lifecycle.use('thread', action)).rejects.toMatchObject({ code: 'CODEX_THREAD_CLOSING' })
    expect(action).not.toHaveBeenCalled()
    expect(unsubscribe).toHaveBeenCalledOnce()
    lifecycle.closed('thread')
    await expect(lifecycle.use('thread', action)).resolves.toBe('sent')
    expect(action).toHaveBeenCalledOnce()
  })

  it('invalidates a waiting reopen when the App Server generation changes', async () => {
    const unsubscribe = vi.fn(async () => ({ status: 'unsubscribed' }))
    const lifecycle = new CodexThreadLifecycle(() => false, unsubscribe, () => undefined, () => undefined)
    const closing = lifecycle.release('thread')
    const action = vi.fn(async () => undefined)
    const reopening = lifecycle.use('thread', action)
    const outcome = expect(reopening).rejects.toMatchObject({ code: 'CODEX_UNAVAILABLE' })
    lifecycle.reset()
    await Promise.all([closing, outcome])
    expect(action).not.toHaveBeenCalled()
    await lifecycle.use('thread', action)
    expect(action).toHaveBeenCalledOnce()
  })

  it('accepts notLoaded without waiting for a nonexistent close notification', async () => {
    const released = vi.fn()
    const lifecycle = new CodexThreadLifecycle(() => false, async () => ({ status: 'notLoaded' }), released, () => undefined)
    await lifecycle.release('thread')
    expect(released).toHaveBeenCalledWith('thread')
    await expect(lifecycle.use('thread', async () => 'ready')).resolves.toBe('ready')
  })

  it('ignores a stale notLoaded response after closed() already opened a newer thread generation', async () => {
    let finishUnsubscribe!: (value: unknown) => void
    const unsubscribe = vi.fn(() => new Promise(resolve => { finishUnsubscribe = resolve }))
    const released = vi.fn()
    const lifecycle = new CodexThreadLifecycle(() => false, unsubscribe, released, () => undefined)

    const closing = lifecycle.release('thread')
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce())
    lifecycle.closed('thread')
    expect(released).toHaveBeenCalledTimes(1)

    let releaseAction!: () => void
    const activeUse = lifecycle.use('thread', () => new Promise<string>(resolve => {
      releaseAction = () => resolve('done')
    }))
    finishUnsubscribe({ status: 'notLoaded' })
    await closing
    expect(released).toHaveBeenCalledTimes(1)

    releaseAction()
    await expect(activeUse).resolves.toBe('done')
  })

  it('ignores a stale notLoaded response when closed() ran while use() was queued on the same state object', async () => {
    let finishFirstUnsubscribe!: (value: unknown) => void
    const unsubscribe = vi.fn(() => new Promise(resolve => { finishFirstUnsubscribe = resolve }))
    const released = vi.fn()
    const lifecycle = new CodexThreadLifecycle(() => false, unsubscribe, released, () => undefined)

    const closingOne = lifecycle.release('thread')
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1))

    // queuedUse keeps state.uses > 0 across closed(), so the same state object stays in the map.
    const queuedUse = lifecycle.use('thread', async () => 'queued')
    lifecycle.closed('thread')
    expect(released).toHaveBeenCalledTimes(1)

    let releaseSecondUse!: () => void
    let secondStarted = false
    const secondUse = lifecycle.use('thread', async () => {
      secondStarted = true
      await new Promise<void>(resolve => { releaseSecondUse = resolve })
      return 'resumed'
    })
    await vi.waitFor(() => expect(secondStarted).toBe(true))

    // First unsubscribe resolves late with notLoaded while secondUse is active on the same state object.
    finishFirstUnsubscribe({ status: 'notLoaded' })
    await Promise.all([closingOne, queuedUse])
    expect(released).toHaveBeenCalledTimes(1)

    releaseSecondUse()
    await expect(secondUse).resolves.toBe('resumed')
  })
})
