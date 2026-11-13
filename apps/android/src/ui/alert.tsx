import { useRef, useSyncExternalStore } from 'react'
import { ConfirmDialog } from '../screens/chat/confirm-dialog'

/**
 * Drop-in replacement for React Native's `Alert.alert`: same call signature,
 * but the dialog renders through the app-themed `ConfirmDialog` instead of the
 * system AlertDialog, so colors, button styling and wording follow the theme.
 * `AlertHost` must be mounted once near the app root.
 */

export interface AlertButton {
  text: string
  style?: 'default' | 'cancel' | 'destructive'
  onPress?: () => void
}

interface AlertRequest {
  title: string
  message?: string
  buttons: AlertButton[]
  onDismiss?: () => void
}

const store = { request: undefined as AlertRequest | undefined }
let notify: (() => void) | undefined

function subscribe(callback: () => void): () => void {
  notify = callback
  return () => { notify = undefined }
}

export const Alert = {
  alert(
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: { cancelable?: boolean; onDismiss?: () => void },
  ): void {
    store.request = {
      title,
      ...(message !== undefined ? { message } : {}),
      buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }],
      ...(options?.onDismiss !== undefined ? { onDismiss: options.onDismiss } : {}),
    }
    notify?.()
  },
}

export function AlertHost() {
  const request = useSyncExternalStore(subscribe, () => store.request)
  // Keep the last request around so the dialog fades out with its content
  // instead of blanking the moment the request is cleared.
  const lastRef = useRef<AlertRequest | undefined>(undefined)
  if (request !== undefined) lastRef.current = request
  const shown = request ?? lastRef.current
  const dismiss = () => {
    const current = store.request
    store.request = undefined
    current?.onDismiss?.()
    notify?.()
  }
  return (
    <ConfirmDialog
      visible={request !== undefined}
      title={shown?.title ?? ''}
      message={shown?.message}
      onClose={dismiss}
      buttons={(shown?.buttons ?? []).map(button => ({
        label: button.text,
        danger: button.style === 'destructive',
        onPress: button.onPress,
      }))}
    />
  )
}
