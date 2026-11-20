import { afterEach, describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { createModalActionQueue } from '../src/screens/chat/modal-action-queue'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('createModalActionQueue', () => {
  it('handles Android immediate execution, iOS dismiss deferral, timeout fallback, cancellation, and error recovery', async () => {
    await runScenarios([
      {
        name: 'waitForDismiss = false runs close and action synchronously without timers',
        run: () => {
          vi.useFakeTimers()
          const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
          const queue = createModalActionQueue(false)
          const events: string[] = []

          queue.run(
            () => { events.push('close-1') },
            () => { events.push('action-1') },
          )

          expect(events).toEqual(['close-1', 'action-1'])
          expect(vi.getTimerCount()).toBe(0)

          queue.onDismiss()
          vi.advanceTimersByTime(2_000)
          expect(events).toEqual(['close-1', 'action-1'])
          expect(warnSpy).not.toHaveBeenCalled()

          queue.run(
            () => { events.push('close-2') },
            () => { events.push('action-2') },
          )
          expect(events).toEqual(['close-1', 'action-1', 'close-2', 'action-2'])
        },
      },
      {
        name: 'waitForDismiss = true defers action until onDismiss, ignores duplicate taps, and unlocks next run',
        run: () => {
          vi.useFakeTimers()
          const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
          const queue = createModalActionQueue(true)
          const events: string[] = []

          queue.onDismiss()

          queue.run(
            () => { events.push('close-1') },
            () => { events.push('action-1') },
          )
          expect(events).toEqual(['close-1'])

          // Duplicate taps while a native modal dismissal is in flight are dropped.
          queue.run(
            () => { events.push('close-dup') },
            () => { events.push('action-dup') },
          )
          expect(events).toEqual(['close-1'])

          vi.advanceTimersByTime(180)
          queue.onDismiss()
          expect(events).toEqual(['close-1', 'action-1'])
          expect(vi.getTimerCount()).toBe(0)

          vi.advanceTimersByTime(1_000)
          expect(warnSpy).not.toHaveBeenCalled()
          expect(events).toEqual(['close-1', 'action-1'])

          queue.run(
            () => { events.push('close-2') },
            () => { events.push('action-2') },
          )
          expect(events).toEqual(['close-1', 'action-1', 'close-2'])
          queue.onDismiss()
          expect(events).toEqual(['close-1', 'action-1', 'close-2', 'action-2'])
        },
      },
      {
        name: 'waitForDismiss = true falls back at 700ms with console.warn once and ignores late onDismiss',
        run: () => {
          vi.useFakeTimers()
          const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
          const queue = createModalActionQueue(true)
          const action1 = vi.fn()
          const action2 = vi.fn()

          queue.run(() => undefined, action1)
          vi.advanceTimersByTime(699)
          expect(action1).not.toHaveBeenCalled()
          expect(warnSpy).not.toHaveBeenCalled()

          vi.advanceTimersByTime(1)
          expect(warnSpy).toHaveBeenCalledTimes(1)
          expect(warnSpy.mock.calls[0]?.[0]).toContain('timed out waiting for Modal onDismiss')
          expect(action1).toHaveBeenCalledTimes(1)

          queue.onDismiss()
          expect(action1).toHaveBeenCalledTimes(1)

          queue.run(() => undefined, action2)
          expect(action2).not.toHaveBeenCalled()
          queue.onDismiss()
          expect(action2).toHaveBeenCalledTimes(1)
        },
      },
      {
        name: 'cancel() clears timer and pending action without blocking subsequent runs',
        run: () => {
          vi.useFakeTimers()
          const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
          const queue = createModalActionQueue(true)
          const action1 = vi.fn()
          const action2 = vi.fn()

          queue.run(() => undefined, action1)
          expect(vi.getTimerCount()).toBe(1)

          queue.cancel()
          expect(vi.getTimerCount()).toBe(0)

          vi.advanceTimersByTime(1_000)
          queue.onDismiss()
          expect(action1).not.toHaveBeenCalled()
          expect(warnSpy).not.toHaveBeenCalled()

          queue.run(() => undefined, action2)
          queue.onDismiss()
          expect(action2).toHaveBeenCalledTimes(1)
        },
      },
      {
        name: 'throwing inside close() clears pending state and leaves queue usable on both platforms',
        run: () => {
          vi.useFakeTimers()
          const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

          for (const waitForDismiss of [true, false]) {
            const queue = createModalActionQueue(waitForDismiss)
            const abortedAction = vi.fn()
            const recoveredAction = vi.fn()

            expect(() => {
              queue.run(() => { throw new Error('close failed') }, abortedAction)
            }).toThrow('close failed')

            expect(vi.getTimerCount()).toBe(0)
            vi.advanceTimersByTime(1_000)
            queue.onDismiss()
            expect(abortedAction).not.toHaveBeenCalled()
            expect(warnSpy).not.toHaveBeenCalled()

            queue.run(() => undefined, recoveredAction)
            if (waitForDismiss) {
              expect(recoveredAction).not.toHaveBeenCalled()
              queue.onDismiss()
            }
            expect(recoveredAction).toHaveBeenCalledTimes(1)
          }
        },
      },
      {
        name: 'throwing inside action() during onDismiss, timeout, or immediate run does not wedge the queue',
        run: () => {
          vi.useFakeTimers()
          const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

          // 1. iOS onDismiss path
          const iosDismissQueue = createModalActionQueue(true)
          iosDismissQueue.run(() => undefined, () => { throw new Error('dismiss action failed') })
          expect(() => iosDismissQueue.onDismiss()).toThrow('dismiss action failed')
          expect(vi.getTimerCount()).toBe(0)
          vi.advanceTimersByTime(1_000)
          expect(warnSpy).not.toHaveBeenCalled()

          const afterDismissError = vi.fn()
          iosDismissQueue.run(() => undefined, afterDismissError)
          iosDismissQueue.onDismiss()
          expect(afterDismissError).toHaveBeenCalledTimes(1)

          // 2. iOS 700ms timeout fallback path
          const iosTimeoutQueue = createModalActionQueue(true)
          iosTimeoutQueue.run(() => undefined, () => { throw new Error('timeout action failed') })
          expect(() => vi.advanceTimersByTime(700)).toThrow('timeout action failed')
          expect(warnSpy).toHaveBeenCalledTimes(1)
          iosTimeoutQueue.onDismiss()

          const afterTimeoutError = vi.fn()
          iosTimeoutQueue.run(() => undefined, afterTimeoutError)
          iosTimeoutQueue.onDismiss()
          expect(afterTimeoutError).toHaveBeenCalledTimes(1)

          // 3. Android immediate path
          const androidQueue = createModalActionQueue(false)
          expect(() => {
            androidQueue.run(() => undefined, () => { throw new Error('android action failed') })
          }).toThrow('android action failed')

          const afterAndroidError = vi.fn()
          androidQueue.run(() => undefined, afterAndroidError)
          expect(afterAndroidError).toHaveBeenCalledTimes(1)
        },
      },
    ], () => {
      vi.useRealTimers()
      vi.restoreAllMocks()
    })
  })
})
