export type GestureSample = {
  dx: number
  dy: number
  x0: number
  vx?: number
}

/** Right swipe to open drawer starts in [MIN, MAX] to avoid system edge back conflict */
export const SWIPE_OPEN_EDGE_MIN = 20
export const SWIPE_OPEN_EDGE_MAX = 240

/** Distance and direction thresholds */
export const OPEN_MIN_DX = 30
export const OPEN_DIRECTION_RATIO = 1.3 // |dx| > |dy| * ratio

export const CLOSE_MIN_DX = 60
export const CLOSE_DIRECTION_RATIO = 1.3

/** Phase 1: Check if gesture should claim responder while swiping right */
export function shouldStartSwipeRightToOpen(
  g: GestureSample,
  trajectory: boolean,
): boolean {
  if (trajectory) return false
  if (g.x0 < SWIPE_OPEN_EDGE_MIN || g.x0 > SWIPE_OPEN_EDGE_MAX) return false
  if (g.dx <= 0) return false
  if (Math.abs(g.dx) < OPEN_MIN_DX) return false
  return g.dx > Math.abs(g.dy) * OPEN_DIRECTION_RATIO
}

/** Phase 2: Check on release if drawer opening is confirmed */
export function shouldConfirmSwipeRightOpen(g: GestureSample): boolean {
  if (g.dx <= 0) return false
  if (Math.abs(g.dx) < OPEN_MIN_DX && (g.vx === undefined || g.vx < 0.3)) return false
  return g.dx > Math.abs(g.dy) * OPEN_DIRECTION_RATIO
}

/** Phase 1: Check if gesture should claim responder while swiping left to close drawer */
export function shouldStartSwipeLeftToClose(g: GestureSample): boolean {
  if (g.dx >= 0) return false
  if (Math.abs(g.dx) < CLOSE_MIN_DX / 2) return false
  return Math.abs(g.dx) > Math.abs(g.dy) * CLOSE_DIRECTION_RATIO
}

/** Phase 2: Check on release if drawer closing is confirmed */
export function shouldConfirmSwipeLeftClose(g: GestureSample): boolean {
  if (g.dx >= 0) return false
  if (Math.abs(g.dx) < CLOSE_MIN_DX && (g.vx === undefined || g.vx > -0.4)) return false
  return Math.abs(g.dx) > Math.abs(g.dy) * CLOSE_DIRECTION_RATIO
}

/** Clamp translation to [-drawerWidth, 0]; positive translation clamps smoothly to 0 */
export function clampDrawerTranslate(value: number, drawerWidth: number): number {
  if (value > 0) return 0
  if (value < -drawerWidth) return -drawerWidth
  return value
}
