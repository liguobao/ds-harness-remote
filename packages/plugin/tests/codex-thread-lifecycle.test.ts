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
})
