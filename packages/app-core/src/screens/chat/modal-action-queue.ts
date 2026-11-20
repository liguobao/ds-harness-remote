const DEFAULT_DISMISS_TIMEOUT_MS = 700

/** UIKit cannot present a picker while the menu's native modal is dismissing. */
export function createModalActionQueue(
  waitForDismiss: boolean,
  dismissTimeoutMs = DEFAULT_DISMISS_TIMEOUT_MS,
) {
  let pending: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const flush = () => {
    clearTimer()
    const action = pending
    pending = undefined
    action?.()
  }

  return {
    run(close: () => void, action: () => void) {
      if (pending) return
      if (waitForDismiss) {
        pending = action
        timer = setTimeout(() => {
          timer = undefined
          if (!pending) return
          console.warn('[modal-action-queue] timed out waiting for Modal onDismiss; running pending action')
          flush()
        }, dismissTimeoutMs)
      }
      try {
        close()
      } catch (error) {
        clearTimer()
        pending = undefined
        throw error
      }
      if (!waitForDismiss) action()
    },
    onDismiss() {
      flush()
    },
    cancel() {
      clearTimer()
      pending = undefined
    },
  }
}
