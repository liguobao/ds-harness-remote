import { useEffect, useState, type ReactNode } from 'react'
import { Keyboard, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { spacing } from './theme'

export function KeyboardInset({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const [keyboardCover, setKeyboardCover] = useState(0)

  useEffect(() => {
    // Edge-to-edge Android often keeps the RN root full-screen even with
    // adjustResize, so KeyboardAvoidingView under-pads and the IME toolbar
    // clips the composer. Measure the real covered band from screenY.
    const show = Keyboard.addListener('keyboardDidShow', event => {
      setKeyboardCover(Math.max(0, windowHeight - event.endCoordinates.screenY))
    })
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardCover(0)
    })
    return () => {
      show.remove()
      hide.remove()
    }
  }, [windowHeight])

  // App shell already reserved insets.bottom below this tree; subtract it so
  // we clear the IME without double-counting the gesture/nav inset. When
  // adjustResize already shrank the window, cover≈0 and this is a no-op.
  const paddingBottom = keyboardCover > 0
    ? Math.max(0, keyboardCover - insets.bottom) + spacing.sm
    : 0

  return (
    <View style={[{ flex: 1 }, paddingBottom > 0 ? { paddingBottom } : null]}>
      {children}
    </View>
  )
}
