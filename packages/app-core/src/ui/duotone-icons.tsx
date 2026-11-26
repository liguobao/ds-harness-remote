// React Native SVG renderer & interactive click/long-press button wrapper for 24x24 SF-style line-duotone icons.
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react'
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  type GestureResponderEvent,
  type Insets,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import Svg, { ClipPath, Defs, G, Mask, Path, Rect } from 'react-native-svg'
import {
  DUOTONE_ICON_ALIASES,
  DUOTONE_ICON_DEFS,
  type DuotoneIconAlias,
  type DuotoneIconName,
  type LineGroupNode,
  type LineIconDef,
  type LinePathNode,
  type LineSvgNode,
  type ToneRef,
} from './duotone-icon-data'
import {
  clamp01,
  computeLineFxMeta,
  computeLineTransform,
  evaluateLineFxAt,
  resolveMonochromeDuotoneTones,
  scalePath,
  type LineFxPose,
} from './duotone-motion'
import { triggerLightHaptic } from './haptics'
import { useTheme } from './theme-context'
import { useReduceMotion } from './use-reduce-motion'

export interface IconTriggerContextValue {
  active: boolean
  pulseSeq: number
  inverse?: boolean
  surfaceColor?: string
}

export const IconTriggerContext = createContext<IconTriggerContextValue | undefined>(undefined)

const round3 = (v: number) => +v.toFixed(3)

function hasMaskPrimitives(): boolean {
  return typeof Defs === 'function' && typeof Mask === 'function' && typeof Rect === 'function'
}

function hasClipPrimitives(): boolean {
  return typeof Defs === 'function' && typeof ClipPath === 'function' && typeof Rect === 'function'
}

export interface DuotoneIconProps {
  name: DuotoneIconName | DuotoneIconAlias
  size?: number
  color?: string
  secondaryColor?: string
  surfaceColor?: string
  inverse?: boolean
  active?: boolean
  style?: StyleProp<ViewStyle>
  fill?: string
  strokeWidth?: number
}

function resolveDef(name: DuotoneIconName | DuotoneIconAlias): LineIconDef {
  if (name in DUOTONE_ICON_DEFS) return DUOTONE_ICON_DEFS[name as DuotoneIconName]!
  const alias = DUOTONE_ICON_ALIASES[name as DuotoneIconAlias]
  return DUOTONE_ICON_DEFS[alias]!
}

function resolveToneColor(tone: ToneRef | undefined, primaryInk: string, secondaryInk: string): string | undefined {
  if (tone === 'p') return primaryInk
  if (tone === 's') return secondaryInk
  return tone
}

/**
 * Renders a 24x24 SF-style line-duotone icon in monochrome black-and-white tones
 * and plays its damped-spring motion (`fx`) on tap, long press, or controlled `active`.
 */
export const DuotoneIcon = memo(function DuotoneIcon({
  name,
  size = 20,
  color,
  secondaryColor,
  surfaceColor,
  inverse,
  active,
  style,
  strokeWidth,
}: DuotoneIconProps) {
  const def = resolveDef(name)
  const { scheme } = useTheme()
  const reduceMotion = useReduceMotion()
  const trigger = useContext(IconTriggerContext)
  const rawId = useId()
  const uid = useMemo(() => `ld${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [rawId])

  const resolvedInverse = inverse ?? trigger?.inverse ?? false
  const resolvedSurface = surfaceColor ?? trigger?.surfaceColor
  const tones = useMemo(
    () =>
      resolveMonochromeDuotoneTones({
        scheme,
        primaryColor: color,
        surfaceColor: resolvedSurface,
        inverse: resolvedInverse,
      }),
    [scheme, color, resolvedSurface, resolvedInverse],
  )
  const primaryInk = tones.primary
  const secondaryInk = secondaryColor ?? tones.secondary
  const strokeScale = strokeWidth !== undefined && Number.isFinite(strokeWidth) ? Math.max(0.5, strokeWidth) / 1.9 : 1

  const isControlledActive = active === true
  const isPressedOrLong = trigger?.active ?? false
  const pulseSeq = trigger?.pulseSeq ?? 0
  const isActive = active ?? isPressedOrLong

  const [poses, setPoses] = useState<Record<string, LineFxPose>>({})
  const frameRef = useRef<number | null>(null)
  const animModeRef = useRef<'oneshot' | 'loop' | null>(null)
  const prevActiveRef = useRef<boolean>(false)
  const prevPulseRef = useRef<number>(pulseSeq)
  const fxMeta = useMemo(() => computeLineFxMeta(def.fx), [def.fx])

  const stopAnimation = useCallback((resetPose: boolean) => {
    if (frameRef.current !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    animModeRef.current = null
    if (resetPose) setPoses({})
  }, [])

  useEffect(() => {
    stopAnimation(true)
  }, [def, reduceMotion, stopAnimation])

  useEffect(() => {
    return () => stopAnimation(false)
  }, [stopAnimation])

  useEffect(() => {
    const activeTurnedOn = !prevActiveRef.current && isActive
    const pulsed = pulseSeq !== prevPulseRef.current && isPressedOrLong
    prevActiveRef.current = isActive
    prevPulseRef.current = pulseSeq

    if (!def.fx || fxMeta.span <= 0 || reduceMotion || typeof requestAnimationFrame !== 'function') {
      if (!isActive || reduceMotion) stopAnimation(true)
      return
    }

    const shouldStart = isActive && (pulsed || activeTurnedOn)
    if (shouldStart) {
      stopAnimation(false)
      const startMs = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const loopContinuously = fxMeta.loops || isControlledActive
      animModeRef.current = loopContinuously ? 'loop' : 'oneshot'

      const tick = (nowTs: number) => {
        if (animModeRef.current === null) return
        const now = typeof nowTs === 'number' ? nowTs : typeof performance !== 'undefined' ? performance.now() : Date.now()
        const t = Math.max(0, now - startMs)
        if (animModeRef.current === 'oneshot' && t >= fxMeta.span) {
          stopAnimation(true)
          return
        }
        const evalT = fxMeta.span > 0 ? t % fxMeta.span : t
        setPoses(evaluateLineFxAt(def.fx, evalT, false))
        frameRef.current = requestAnimationFrame(tick)
      }

      frameRef.current = requestAnimationFrame(tick)
      return
    }

    // Stop controlled/looping effects immediately when deactivated, while letting
    // natural one-shot tap springs complete unless explicitly overridden with active={false}.
    if (!isActive && (active === false || animModeRef.current === 'loop')) {
      stopAnimation(true)
    }
  }, [isActive, isControlledActive, isPressedOrLong, active, pulseSeq, def, fxMeta, reduceMotion, stopAnimation])

  const canMask = hasMaskPrimitives()
  const canClip = hasClipPrimitives()

  const rendered = useMemo(() => {
    const defsNodes: ReactNode[] = []
    let clipCounter = 0

    const renderNode = (node: LineSvgNode, keyPrefix: string, activeLayerPose?: LineFxPose): ReactNode => {
      if (node.k === 'rect') {
        return <Rect key={keyPrefix} x={node.x} y={node.y} width={node.w} height={node.h} fill={node.fill} />
      }
      if (node.k === 'path') {
        const p: LinePathNode = node
        const gx = activeLayerPose?.gx ?? 1
        const gy = activeLayerPose?.gy ?? 1
        const bent = Math.abs(gx - 1) > 1e-4 || Math.abs(gy - 1) > 1e-4
        const [ox, oy] = activeLayerPose?.o ?? [12, 12]
        const d = bent ? scalePath(p.d, gx, gy, ox, oy) : p.d
        const fillColor = resolveToneColor(p.fill, primaryInk, secondaryInk) ?? 'none'
        const strokeColor = resolveToneColor(p.stroke, primaryInk, secondaryInk)
        const sw = p.sw !== undefined ? round3(p.sw * strokeScale) : undefined
        const w = activeLayerPose?.w
        const len = p.len ?? 24
        const strokeDasharray =
          strokeColor && w !== undefined && w < 0.999
            ? [Math.max(0.001, clamp01(w) * len), len + 2]
            : undefined
        const strokeOpacity = strokeColor && w !== undefined && w < 0.01 ? 0 : undefined

        let el: ReactNode = (
          <Path
            key={keyPrefix}
            d={d}
            fill={fillColor}
            fillRule={p.fillRule}
            stroke={strokeColor}
            strokeWidth={sw}
            strokeLinecap={strokeColor ? p.cap ?? 'round' : undefined}
            strokeLinejoin={strokeColor ? 'round' : undefined}
            strokeDasharray={strokeDasharray}
            strokeOpacity={strokeOpacity}
          />
        )
        if (p.tf) {
          el = (
            <G key={keyPrefix} transform={p.tf}>
              {el}
            </G>
          )
        }
        return el
      }

      const g: LineGroupNode = node
      const layerPose = g.l ? poses[g.l] : activeLayerPose
      const children = g.ch.map((ch, idx) => renderNode(ch, `${keyPrefix}-${idx}`, layerPose))
      const tf = layerPose ? computeLineTransform(layerPose) : undefined
      const opacity = layerPose?.a !== undefined ? clamp01(layerPose.a) : g.op
      const maskProp = g.mask && canMask ? `url(#${uid}-${g.mask})` : undefined

      let clipPathProp: string | undefined
      if (canClip && (layerPose?.clip !== undefined || layerPose?.clipY !== undefined)) {
        const cid = `${uid}-cp${clipCounter++}`
        const cw = layerPose.clip === undefined ? 36 : round3(Math.max(0, layerPose.clip + 6))
        const ch = layerPose.clipY === undefined ? 36 : round3(Math.max(0, layerPose.clipY + 6))
        defsNodes.push(
          <ClipPath key={cid} id={cid}>
            <Rect x="-6" y="-6" width={cw} height={ch} />
          </ClipPath>,
        )
        clipPathProp = `url(#${cid})`
      }

      return (
        <G key={keyPrefix} transform={tf} opacity={opacity} mask={maskProp} clipPath={clipPathProp}>
          {children}
        </G>
      )
    }

    if (def.masks && canMask) {
      for (const m of def.masks) {
        const maskId = `${uid}-${m.id}`
        defsNodes.push(
          <Mask key={maskId} id={maskId} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="-6" y="-6" width="36" height="36">
            {m.ch.map((ch, idx) => renderNode(ch, `${maskId}-${idx}`))}
          </Mask>,
        )
      }
    }

    const allPose = poses.all
    const allTf = allPose ? computeLineTransform(allPose) : undefined
    const allOpacity = allPose?.a !== undefined ? clamp01(allPose.a) : undefined
    const bodyNodes = def.body.map((node, idx) => renderNode(node, `b-${idx}`))

    return {
      defsNodes,
      rootContent:
        allTf !== undefined || allOpacity !== undefined ? (
          <G transform={allTf} opacity={allOpacity}>
            {bodyNodes}
          </G>
        ) : (
          <G>{bodyNodes}</G>
        ),
    }
  }, [def, poses, primaryInk, secondaryInk, strokeScale, uid, canMask, canClip])

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      {rendered.defsNodes.length > 0 && <Defs>{rendered.defsNodes}</Defs>}
      {rendered.rootContent}
    </Svg>
  )
})

const OUTER_LAYOUT_KEYS = new Set<keyof ViewStyle>([
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'minWidth',
  'maxWidth',
  'alignSelf',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'start',
  'end',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'marginStart',
  'marginEnd',
  'marginHorizontal',
  'marginVertical',
  'aspectRatio',
  'display',
  'zIndex',
])

export function splitOuterAndInnerStyle(style: StyleProp<ViewStyle>): {
  outer: ViewStyle | undefined
  inner: ViewStyle | undefined
} {
  if (!style) return { outer: undefined, inner: undefined }
  const flat: ViewStyle =
    typeof StyleSheet?.flatten === 'function'
      ? ((StyleSheet.flatten(style) as ViewStyle | undefined) ?? {})
      : Array.isArray(style)
        ? Object.assign({}, ...style.filter(Boolean))
        : (style as ViewStyle)
  const outer: Record<string, unknown> = {}
  const inner: Record<string, unknown> = {}
  let hasOuter = false
  let hasInner = false
  for (const [k, v] of Object.entries(flat)) {
    if (v === undefined) continue
    if (OUTER_LAYOUT_KEYS.has(k as keyof ViewStyle)) {
      outer[k] = v
      hasOuter = true
    } else {
      inner[k] = v
      hasInner = true
    }
  }
  if (hasOuter && outer.position === 'absolute') {
    inner.flex = 1
    if (inner.width !== undefined) outer.width = inner.width
    if (inner.height !== undefined) outer.height = inner.height
    if (inner.width !== undefined || (outer.left !== undefined && outer.right !== undefined)) {
      inner.width = '100%'
    }
    if (inner.height !== undefined || (outer.top !== undefined && outer.bottom !== undefined)) {
      inner.height = '100%'
    }
    hasInner = true
  }
  return {
    outer: hasOuter ? (outer as ViewStyle) : undefined,
    inner: hasInner ? (inner as ViewStyle) : undefined,
  }
}

export type MotionPressableProps = Omit<PressableProps, 'style' | 'children'> & {
  children?: ReactNode | ((state: { pressed: boolean; longPressed: boolean }) => ReactNode)
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>)
  inverse?: boolean
  surfaceColor?: string
  scaleTo?: number
  disableScale?: boolean
  enableLongPressFeedback?: boolean
  tapHoldMs?: number
  hitSlop?: number | Insets
}

export function MotionPressable({
  children,
  style,
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  disabled = false,
  inverse = false,
  surfaceColor,
  scaleTo = 0.95,
  disableScale = false,
  enableLongPressFeedback = true,
  tapHoldMs = 420,
  delayLongPress = 360,
  ...rest
}: MotionPressableProps) {
  const { colors } = useTheme()
  const reduceMotion = useReduceMotion()
  const [pressed, setPressed] = useState(false)
  const [longPressed, setLongPressed] = useState(false)
  const [iconActive, setIconActive] = useState(false)
  const [pulseSeq, setPulseSeq] = useState(0)

  const pressInTimeRef = useRef(0)
  const longPressedRef = useRef(false)
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scaleAnim = useRef(new Animated.Value(1)).current
  const haloAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!disabled) return
    if (releaseTimerRef.current !== null) {
      clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = null
    }
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    longPressedRef.current = false
    setPressed(false)
    setLongPressed(false)
    setIconActive(false)
    scaleAnim.setValue(1)
    haloAnim.setValue(0)
  }, [disabled, haloAnim, scaleAnim])

  useEffect(() => {
    return () => {
      if (releaseTimerRef.current !== null) {
        clearTimeout(releaseTimerRef.current)
        releaseTimerRef.current = null
      }
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
    }
  }, [])

  const animateScale = useCallback(
    (toValue: number, duration: number, spring = false) => {
      if (disableScale || reduceMotion) {
        scaleAnim.setValue(1)
        return
      }
      if (spring && typeof Animated?.spring === 'function') {
        Animated.spring(scaleAnim, {
          toValue,
          bounciness: 6,
          speed: 22,
          useNativeDriver: true,
        }).start()
        return
      }
      if (typeof Animated?.timing === 'function') {
        Animated.timing(scaleAnim, {
          toValue,
          duration,
          easing: Easing?.out ? Easing.out(Easing.cubic) : undefined,
          useNativeDriver: true,
        }).start()
      }
    },
    [disableScale, reduceMotion, scaleAnim],
  )

  const triggerLongPressHalo = useCallback(() => {
    if (reduceMotion) return
    haloAnim.setValue(0)
    if (typeof Animated?.timing === 'function') {
      Animated.timing(haloAnim, {
        toValue: 1,
        duration: 420,
        easing: Easing?.out ? Easing.out(Easing.cubic) : undefined,
        useNativeDriver: true,
      }).start(() => haloAnim.setValue(0))
    }
    if (!disableScale && typeof Animated?.sequence === 'function' && typeof Animated?.timing === 'function') {
      Animated.sequence([
        Animated.timing(scaleAnim, { toValue: Math.min(1.03, scaleTo + 0.08), duration: 110, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: scaleTo, duration: 140, useNativeDriver: true }),
      ]).start()
    }
  }, [disableScale, haloAnim, reduceMotion, scaleAnim, scaleTo])

  const fireLongPressVisual = useCallback(() => {
    if (longPressedRef.current) return
    longPressedRef.current = true
    setLongPressed(true)
    setIconActive(true)
    setPulseSeq((n) => n + 1)
    if (enableLongPressFeedback) {
      triggerLightHaptic()
      triggerLongPressHalo()
    }
  }, [enableLongPressFeedback, triggerLongPressHalo])

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      if (disabled) return
      if (releaseTimerRef.current !== null) {
        clearTimeout(releaseTimerRef.current)
        releaseTimerRef.current = null
      }
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
      pressInTimeRef.current = Date.now()
      longPressedRef.current = false
      setPressed(true)
      setLongPressed(false)
      setIconActive(true)
      setPulseSeq((n) => n + 1)
      animateScale(scaleTo, 110, false)
      if (enableLongPressFeedback || onLongPress !== undefined) {
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null
          fireLongPressVisual()
        }, delayLongPress ?? 360)
      }
      onPressIn?.(e)
    },
    [animateScale, delayLongPress, disabled, enableLongPressFeedback, fireLongPressVisual, onLongPress, onPressIn, scaleTo],
  )

  const handleLongPress = useCallback(
    (e: GestureResponderEvent) => {
      if (disabled) return
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
      fireLongPressVisual()
      onLongPress?.(e)
    },
    [disabled, fireLongPressVisual, onLongPress],
  )

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      if (longPressTimerRef.current !== null) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
      setPressed(false)
      setLongPressed(false)
      animateScale(1, 180, true)

      const elapsed = Date.now() - pressInTimeRef.current
      const remaining = longPressedRef.current ? 0 : Math.max(0, tapHoldMs - elapsed)
      if (remaining === 0) {
        setIconActive(false)
      } else {
        releaseTimerRef.current = setTimeout(() => {
          releaseTimerRef.current = null
          setIconActive(false)
        }, remaining)
      }
      onPressOut?.(e)
    },
    [animateScale, onPressOut, tapHoldMs],
  )

  const resolvedStyle = typeof style === 'function' ? style({ pressed }) : style
  const { outer, inner } = splitOuterAndInnerStyle(resolvedStyle)
  const borderRadius = typeof inner?.borderRadius === 'number' ? inner.borderRadius : 12

  const haloScale = haloAnim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.12] })
  const haloOpacity = haloAnim.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.28, 0] })
  const haloColor = inverse ? colors.onInverse : colors.ink

  const ctxValue = useMemo<IconTriggerContextValue>(
    () => ({ active: iconActive, pulseSeq, inverse, surfaceColor }),
    [iconActive, pulseSeq, inverse, surfaceColor],
  )

  return (
    <IconTriggerContext.Provider value={ctxValue}>
      <Animated.View style={[outer, !disableScale && !reduceMotion && { transform: [{ scale: scaleAnim }] }]}>
        <Pressable
          {...rest}
          disabled={disabled}
          delayLongPress={delayLongPress}
          onPress={onPress}
          onLongPress={onLongPress ? handleLongPress : undefined}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={inner}
        >
          {typeof children === 'function' ? children({ pressed, longPressed }) : children}
          {enableLongPressFeedback && !reduceMotion && (
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  borderRadius,
                  borderWidth: 1.5,
                  borderColor: haloColor,
                  opacity: haloOpacity,
                  transform: [{ scale: haloScale }],
                },
              ]}
            />
          )}
        </Pressable>
      </Animated.View>
    </IconTriggerContext.Provider>
  )
}

export type DuotoneIconComponent = ComponentType<Omit<DuotoneIconProps, 'name'>>

function makeIcon(alias: DuotoneIconAlias): DuotoneIconComponent {
  const Component = memo(function LineDuotoneNamedIcon(props: Omit<DuotoneIconProps, 'name'>) {
    return <DuotoneIcon name={alias} {...props} />
  })
  Component.displayName = `LineIcon(${alias})`
  return Component
}

export const DuotoneIcons = Object.fromEntries(
  (Object.keys(DUOTONE_ICON_ALIASES) as DuotoneIconAlias[]).map((alias) => [alias, makeIcon(alias)]),
) as Record<DuotoneIconAlias, DuotoneIconComponent>
