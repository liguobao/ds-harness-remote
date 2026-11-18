import { useEffect, useRef, type RefObject } from 'react'
import { BackHandler, Keyboard, type TextInput } from 'react-native'

type BackPanel = { open: boolean; close: () => void }

/** Ordered panels keep the existing back priority; the listener always reads current state. */
export function useChatBackHandler(
  input: RefObject<TextInput | null>,
  onBack: () => boolean | void,
  panels: BackPanel[],
  active = true,
) {
  const latest = useRef({ onBack, panels, active })
  latest.current = { onBack, panels, active }
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!latest.current.active) return false
      const panel = latest.current.panels.find(panel => panel.open)
      if (panel !== undefined) {
        panel.close()
        return true
      }
      // Focus is authoritative: Android may drop keyboard visibility events.
      if (input.current?.isFocused() === true) {
        Keyboard.dismiss()
        return true
      }
      Keyboard.dismiss()
      return latest.current.onBack() !== false
    })
    return () => subscription.remove()
  }, [input])
}
