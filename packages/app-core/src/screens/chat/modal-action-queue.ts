/** UIKit cannot present a picker while the menu's native modal is dismissing. */
export function createModalActionQueue(waitForDismiss: boolean) {
  let pending: (() => void) | undefined
  return {
    run(close: () => void, action: () => void) {
      if (pending) return
      if (waitForDismiss) pending = action
      close()
      if (!waitForDismiss) action()
    },
    onDismiss() {
      const action = pending
      pending = undefined
      action?.()
    },
    cancel() {
      pending = undefined
    },
  }
}
