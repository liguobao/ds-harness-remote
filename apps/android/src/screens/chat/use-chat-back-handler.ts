import { useEffect, useRef, type RefObject } from 'react'
import { BackHandler, Keyboard, type TextInput } from 'react-native'

type BackPanel = { open: boolean; close: () => void }

/** Ordered panels keep the existing back priority; the listener always reads current state. */
export function useChatBackHandler(input: RefObject<TextInput | null>, onBack: () => void, panels: BackPanel[]) {
  const latest = useRef({ onBack, panels })
  latest.current = { onBack, panels }
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
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
      latest.current.onBack()
      return true
    })
    return () => subscription.remove()
  }, [input])
}
