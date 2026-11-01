import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState, Keyboard, LayoutAnimation, Platform, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/**
 * Reserve the band the IME covers so the composer/content clears it,
 * while respecting edge-to-edge system insets without double-counting.
 *
 * Android edge-to-edge rules:
 * 1. Under Android 15 edge-to-edge (and targetSdk 35), the Activity window
 *    remains full-screen (does not shrink under adjustResize). In this mode,
 *    the IME overlays the bottom of the window: windowHeight - keyboardScreenY > 0.
 * 2. On older Android or non-edge-to-edge devices where adjustResize shrinks
 *    the RN window, windowHeight becomes <= keyboardScreenY (the window already
 *    resizes to fit above the IME). In this case, windowHeight - keyboardScreenY <= 0,
 *    so keyboardCover collapses to 0, preventing double padding.
 * 3. When the keyboard is closed, the bottom padding provides clearance for
 *    the system navigation bar / gesture navigation handle (insets.bottom).
 * 4. When the keyboard is open, the IME physically covers the bottom system bar,
 *    so insets.bottom is replaced by the keyboard cover instead of being added twice.
 * 5. Window height growth (when IME releases the window under adjustResize),
 *    window resizes (rotation/split screen) and AppState transitions
 *    automatically re-sync or clear any stale state from dropped events.
 */
export function KeyboardInset({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const [keyboardScreenY, setKeyboardScreenY] = useState<number | null>(null)
  const windowRef = useRef({ width: windowWidth, height: windowHeight })

  const measure = useCallback((screenY: number) => {
    setKeyboardScreenY(screenY)
  }, [])

  useEffect(() => {
    if (Platform.OS === 'ios') {
      const willShow = Keyboard.addListener('keyboardWillShow', (event: { duration?: number; easing?: string; endCoordinates: { screenY: number } }) => {
        const duration = event.duration ?? 250
        if (duration > 0) {
          const animationType = ((event.easing ? (LayoutAnimation.Types as Record<string, any>)[event.easing] : undefined) ?? LayoutAnimation.Types.keyboard)
          LayoutAnimation.configureNext(
            LayoutAnimation.create(
              duration,
              animationType,
              LayoutAnimation.Properties.opacity,
            ),
          )
        }
        setKeyboardScreenY(event.endCoordinates.screenY)
      })
      const willHide = Keyboard.addListener('keyboardWillHide', (event: { duration?: number; easing?: string }) => {
        const duration = event.duration ?? 250
        if (duration > 0) {
          const animationType = ((event.easing ? (LayoutAnimation.Types as Record<string, any>)[event.easing] : undefined) ?? LayoutAnimation.Types.keyboard)
          LayoutAnimation.configureNext(
            LayoutAnimation.create(
              duration,
              animationType,
              LayoutAnimation.Properties.opacity,
            ),
          )
        }
        setKeyboardScreenY(null)
      })
      return () => {
        willShow.remove()
        willHide.remove()
      }
    }
    const show = Keyboard.addListener('keyboardDidShow', event => measure(event.endCoordinates.screenY))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardScreenY(null))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [measure])

  useEffect(() => {
    const previous = windowRef.current
    windowRef.current = { width: windowWidth, height: windowHeight }
    if (previous.width === windowWidth && previous.height === windowHeight) return
    // Rotation (or a window resize) moves the IME's top edge too, and Android
    // does not guarantee another keyboardDidShow for the kept-open keyboard.
    // Re-sync from live metrics so padding is not computed from the old
    // orientation; fall back to the safe-area inset when metrics are gone.
    if (Keyboard.isVisible()) {
      const metrics = Keyboard.metrics()
      setKeyboardScreenY(metrics && typeof metrics.screenY === 'number' ? metrics.screenY : null)
    } else {
      setKeyboardScreenY(null)
    }
  }, [windowWidth, windowHeight])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        // When returning to the foreground, re-sync keyboard coordinates.
        // If the keyboard remained open without emitting a new show event, restore the coordinate.
        // If the keyboard closed while in background, clear it so we fall back to insets.bottom.
        if (Keyboard.isVisible()) {
          const metrics = Keyboard.metrics()
          if (metrics && typeof metrics.screenY === 'number') {
            setKeyboardScreenY(metrics.screenY)
          }
        } else {
          setKeyboardScreenY(null)
        }
      }
    })
    return () => subscription.remove()
  }, [])

  // When keyboard is open:
  // - If window did not shrink (e.g. Android 15 edge-to-edge): windowHeight - keyboardScreenY gives the exact IME overlap.
  // - If adjustResize already shrunk the window: windowHeight <= keyboardScreenY, cover collapses to 0 (no extra padding).
  // When keyboard is closed:
  // - Reserve insets.bottom so controls clear the navigation/gesture bar.
  const paddingBottom = keyboardScreenY !== null
    ? Math.max(0, windowHeight - keyboardScreenY)
    : insets.bottom

  return (
    <View style={[{ flex: 1 }, paddingBottom > 0 ? { paddingBottom } : null]}>
      {children}
    </View>
  )
}
