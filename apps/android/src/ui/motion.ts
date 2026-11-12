/**
 * Motion tokens and pure geometry/state helpers.
 *
 * This module intentionally imports nothing from `react-native` so the shared
 * decisions (durations, reduced-motion fallback, sheet phase machine, anchor
 * geometry) stay unit-testable in Node. The React Native wrappers
 * (`ui/sheet.tsx`, `ui/use-reduce-motion.ts`) consume these values.
 */

export type MotionKind = 'sheet' | 'fullscreen' | 'indicator' | 'micro'

/** Window-space rectangle, as returned by `measureInWindow`. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * `opening`/`closing` are in flight, `open`/`unmounted` are settled. A visible
 * change retargets from the current phase instead of restarting from zero.
 */
export type SheetPhase = 'unmounted' | 'opening' | 'open' | 'closing'

/** Phone defaults from the design brief; desktop uses two thirds of these. */
export const motionTokens = {
  duration: {
    micro: 160,
    sheet: 380,
    sheetExit: 260,
    fullscreen: 480,
    indicator: 420,
    stagger: 25,
    reduced: 150,
  },
  /** Cubic-bezier control points: fast start, long tail. */
  easing: {
    expand: [0.32, 0.72, 0, 1],
    retreat: [0.4, 0, 0.6, 1],
  },
  spring: { bounciness: 0, speed: 14 },
} as const

export type EasingCurve = readonly [number, number, number, number]

/** Named cubic-bezier control points, ready to spread into `Easing.bezier`. */
export function easingCurve(name: 'expand' | 'retreat'): EasingCurve {
  return motionTokens.easing[name]
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function isRect(value: Rect): boolean {
  return [value.x, value.y, value.width, value.height].every(Number.isFinite)
}

/**
 * Reduced motion keeps the state change but removes travel and scale, and caps
 * every duration at 150ms.
 */
export function resolveMotion(kind: MotionKind, reduceMotion: boolean): {
  duration: number
  translate: number
  scale: number
} {
  if (reduceMotion) {
    return { duration: motionTokens.duration.reduced, translate: 0, scale: 1 }
  }
  switch (kind) {
    case 'sheet': return { duration: motionTokens.duration.sheet, translate: 24, scale: 1 }
    case 'fullscreen': return { duration: motionTokens.duration.fullscreen, translate: 24, scale: 1 }
    case 'indicator': return { duration: motionTokens.duration.indicator, translate: 0, scale: 1 }
    case 'micro': return { duration: motionTokens.duration.micro, translate: 6, scale: 1 }
  }
}

/** Enter is slower than exit so dismissal feels immediate. */
export function sheetPhaseDuration(phase: SheetPhase, reduceMotion: boolean): number {
  if (reduceMotion) return motionTokens.duration.reduced
  return phase === 'opening' ? motionTokens.duration.sheet : motionTokens.duration.sheetExit
}

/**
 * Pure phase transition. Closing is never skipped: showing again while closing
 * re-enters `opening` so the animation continues from its current frame.
 */
export function nextSheetPhase(phase: SheetPhase, visible: boolean): SheetPhase {
  if (visible) {
    return phase === 'unmounted' || phase === 'closing' ? 'opening' : phase
  }
  return phase === 'unmounted' ? 'unmounted' : 'closing'
}

/**
 * Vertical travel for a sheet that grows out of its trigger. Bottom-half
 * triggers rise from below; top-half triggers drop in from above so a menu
 * under a toolbar does not slide up from off screen.
 */
export function anchorRise(anchor: Rect | undefined, windowHeight: number): number {
  const fallback = 24
  if (anchor === undefined || !isRect(anchor)) return fallback
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return fallback
  const center = anchor.y + anchor.height / 2
  return center < windowHeight / 2 ? -16 : fallback
}

/**
 * Shared-rectangle tween for a view positioned at `from` with its natural
 * size: progress 0 is the identity (thumbnail), progress 1 lands exactly on
 * `to`. Only transform output so no layout property is ever animated.
 */
export function sharedFrame(from: Rect, to: Rect, progress: number): {
  translateX: number
  translateY: number
  scaleX: number
  scaleY: number
} {
  const p = clamp(progress, 0, 1)
  if (!isRect(from) || !isRect(to) || from.width <= 0 || from.height <= 0 || p === 0) {
    return { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 }
  }
  return {
    translateX: (to.x - from.x) * p,
    translateY: (to.y - from.y) * p,
    scaleX: (from.width + (to.width - from.width) * p) / from.width,
    scaleY: (from.height + (to.height - from.height) * p) / from.height,
  }
}

/**
 * Two equal-width segments (`flex: 1`) with an inset track: index 0 sits at the
 * inset, index 1 one segment further. Zero/unknown widths collapse to a
 * zero-width indicator instead of jumping to an arbitrary position.
 */
export function indicatorGeometry(index: 0 | 1, trackWidth: number, inset: number): {
  x: number
  width: number
} {
  const safeInset = Math.max(0, Number.isFinite(inset) ? inset : 0)
  const width = Number.isFinite(trackWidth) && trackWidth > 0
    ? Math.max(0, (trackWidth - safeInset * 2) / 2)
    : 0
  return { x: safeInset + (index === 1 ? width : 0), width }
}
