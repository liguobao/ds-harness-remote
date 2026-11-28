import { useRef, useSyncExternalStore } from 'react'
import { Alert as RNAlert, Platform } from 'react-native'
import { ConfirmDialog, type ConfirmDialogCloseCause } from '../screens/chat/confirm-dialog'

/**
 * Drop-in replacement for React Native's `Alert.alert`: uses the native system
 * alert on iOS and renders through the app-themed `ConfirmDialog` on Android.
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

// On iOS, `RCTAlertManager` invokes a button's `onPress` inside `UIAlertAction`'s
// completion handler right as `[RCTAlertController hide]` tears down `_alertWindow`
// and restores key-window focus. Deferring button callbacks by one macrotask and
// queuing any follow-up `Alert.alert` triggered during that unwind prevents heavy
// Fabric subtree mutations or a second `UIAlertController` from colliding with
// UIKit's alert-window dismissal transaction.
let iosAlertUnwinding = false
const iosPendingAlerts: Array<() => void> = []

function flushNextIosAlert(): void {
  if (iosAlertUnwinding || iosPendingAlerts.length === 0) return
  const next = iosPendingAlerts.shift()
  if (next !== undefined) {
    iosAlertUnwinding = true
    setTimeout(() => {
      iosAlertUnwinding = false
      try {
        next()
      } finally {
        flushNextIosAlert()
      }
    }, 0)
  }
}

function wrapIosButtons(buttons?: AlertButton[]): AlertButton[] | undefined {
  if (buttons === undefined) return undefined
  return buttons.map(button => ({
    ...button,
    onPress: () => {
      iosAlertUnwinding = true
      setTimeout(() => {
        try {
          button.onPress?.()
        } finally {
          iosAlertUnwinding = false
          flushNextIosAlert()
        }
      }, 0)
    },
  }))
}

export function resetIosAlertStateForTesting(): void {
  iosAlertUnwinding = false
  iosPendingAlerts.length = 0
}

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
    if (Platform.OS === 'ios') {
      const present = () => {
        RNAlert.alert(title, message, wrapIosButtons(buttons), options)
      }
      if (iosAlertUnwinding) {
        iosPendingAlerts.push(present)
      } else {
        present()
      }
      return
    }
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
  if (Platform.OS === 'ios') return null
  return <AndroidAlertHost />
}

function AndroidAlertHost() {
  const request = useSyncExternalStore(subscribe, () => store.request)
  // Keep the last request around so the dialog fades out with its content
  // instead of blanking the moment the request is cleared.
  const lastRef = useRef<AlertRequest | undefined>(undefined)
  if (request !== undefined) lastRef.current = request
  const shown = request ?? lastRef.current
  // React Native's Alert only calls `onDismiss` when the alert is closed without
  // picking a button (backdrop tap or back). Button presses must not settle a
  // caller's "cancelled" promise before its own action runs.
  const dismiss = (cause: ConfirmDialogCloseCause) => {
    const current = store.request
    store.request = undefined
    if (cause === 'dismiss') current?.onDismiss?.()
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
        role: button.style,
        onPress: button.onPress,
      }))}
    />
  )
}
