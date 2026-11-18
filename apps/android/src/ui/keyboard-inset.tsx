import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, AppState, Keyboard, LayoutAnimation, NativeEventEmitter, NativeModules, Platform, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

const KeyboardInsetActiveContext = createContext(false)

type KeyboardInsetsNativeModule = {
  startObserving?: () => Promise<{ paddingBottom?: number; imeVisible?: boolean } | null>
  addListener?: (eventName: string) => void
  removeListeners?: (count: number) => void
}

function androidNativeKeyboardInsets(): KeyboardInsetsNativeModule | undefined {
  if (Platform.OS !== 'android') return undefined
  const mod = NativeModules?.DshRemoteKeyboardInsets as KeyboardInsetsNativeModule | undefined
  return mod && typeof mod.startObserving === 'function' ? mod : undefined
}

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
  const parentActive = useContext(KeyboardInsetActiveContext)
  if (parentActive) {
    return <View style={{ flex: 1 }}>{children}</View>
  }
  const nativeModule = androidNativeKeyboardInsets()
  if (nativeModule !== undefined) {
    return (
      <KeyboardInsetActiveContext.Provider value={true}>
        <AndroidNativeKeyboardInset nativeModule={nativeModule}>{children}</AndroidNativeKeyboardInset>
      </KeyboardInsetActiveContext.Provider>
    )
  }
  return (
    <KeyboardInsetActiveContext.Provider value={true}>
      <FallbackKeyboardInset>{children}</FallbackKeyboardInset>
    </KeyboardInsetActiveContext.Provider>
  )
}

function AndroidNativeKeyboardInset({
  nativeModule,
  children,
}: {
  nativeModule: KeyboardInsetsNativeModule
  children: ReactNode
}) {
  const insets = useSafeAreaInsets()
  const safeBottomRef = useRef(insets.bottom)
  safeBottomRef.current = insets.bottom
  const animatedPaddingBottom = useRef(new Animated.Value(insets.bottom)).current
  const imeVisibleRef = useRef(false)
  const lastNativeDpRef = useRef<number | null>(null)

  useEffect(() => {
    if (!imeVisibleRef.current) {
      const target = lastNativeDpRef.current === null
        ? insets.bottom
        : Math.max(insets.bottom, lastNativeDpRef.current)
      animatedPaddingBottom.setValue(target)
    }
  }, [insets.bottom, animatedPaddingBottom])

  useEffect(() => {
    let active = true
    const apply = (paddingBottom?: number, imeVisible?: boolean) => {
      if (!active || typeof paddingBottom !== 'number' || !Number.isFinite(paddingBottom)) return
      const visible = imeVisible === true
      imeVisibleRef.current = visible
      lastNativeDpRef.current = paddingBottom
      // When the IME is hidden, never dip below the known safe-area bottom inset.
      animatedPaddingBottom.setValue(visible ? Math.max(0, paddingBottom) : Math.max(safeBottomRef.current, paddingBottom))
    }

    const emitter = new NativeEventEmitter(nativeModule as NonNullable<typeof NativeModules.DshRemoteKeyboardInsets>)
    const subscription = emitter.addListener(
      'remoteKeyboardInsetsChanged',
      (event: { paddingBottom?: number; imeVisible?: boolean }) => {
        apply(event?.paddingBottom, event?.imeVisible)
      },
    )

    void nativeModule.startObserving?.()
      .then(initial => {
        if (initial) apply(initial.paddingBottom, initial.imeVisible)
      })
      .catch(() => undefined)

    return () => {
      active = false
      subscription.remove()
    }
  }, [nativeModule, animatedPaddingBottom])

  return (
    <Animated.View style={{ flex: 1, paddingBottom: animatedPaddingBottom }}>
      {children}
    </Animated.View>
  )
}

function FallbackKeyboardInset({ children }: { children: ReactNode }) {
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

  // Discard stale coordinates synchronously if the window just grew back after keyboard close.
  const windowGrew = windowHeight > windowRef.current.height
  const effectiveKeyboardScreenY = windowGrew && !Keyboard.isVisible() ? null : keyboardScreenY

  const paddingBottom = effectiveKeyboardScreenY !== null
    ? Math.max(0, windowHeight - effectiveKeyboardScreenY)
    : insets.bottom

  return (
    <View style={[{ flex: 1 }, paddingBottom > 0 ? { paddingBottom } : null]}>
      {children}
    </View>
  )
}
