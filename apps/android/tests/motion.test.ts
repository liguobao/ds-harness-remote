import { describe, expect, it } from 'vitest'
import {
  anchorRise,
  clamp,
  indicatorGeometry,
  motionTokens,
  resolveMotion,
  sharedFrame,
  type MotionKind,
  type Rect,
} from '../src/ui/motion'

const KINDS: MotionKind[] = ['sheet', 'fullscreen', 'indicator', 'micro']

describe('motion tokens and reduced-motion fallback', () => {
  it('caps every reduced-motion transition at 150ms with no travel or scale', () => {
    for (const kind of KINDS) {
      expect(resolveMotion(kind, true), `kind: ${kind}`).toEqual({
        duration: motionTokens.duration.reduced,
        translate: 0,
        scale: 1,
      })
      expect(resolveMotion(kind, true).duration).toBeLessThanOrEqual(150)
    }
  })

  it('uses the phone defaults from the design brief when motion is allowed', () => {
    expect(resolveMotion('sheet', false)).toMatchObject({ duration: 380 })
    expect(resolveMotion('fullscreen', false)).toMatchObject({ duration: 480 })
    expect(resolveMotion('indicator', false)).toMatchObject({ duration: 420 })
    expect(resolveMotion('micro', false)).toMatchObject({ duration: 160 })
    for (const kind of KINDS) {
      const motion = resolveMotion(kind, false)
      expect(motion.duration).toBeGreaterThanOrEqual(150)
      expect(motion.duration).toBeLessThanOrEqual(480)
    }
  })

  it('keeps easing control points inside a usable cubic-bezier range', () => {
    for (const curve of [motionTokens.easing.expand, motionTokens.easing.retreat]) {
      expect(curve).toHaveLength(4)
      expect(curve[0]).toBeGreaterThanOrEqual(0)
      expect(curve[0]).toBeLessThanOrEqual(1)
      expect(curve[2]).toBeGreaterThanOrEqual(0)
      expect(curve[2]).toBeLessThanOrEqual(1)
    }
  })

  it('clamps non-finite input instead of propagating NaN into a transform', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
    expect(clamp(Number.NaN, 2, 10)).toBe(2)
    expect(clamp(Number.POSITIVE_INFINITY, 0, 10)).toBe(0)
  })
})

describe('sheet anchor geometry (pattern f: control grows its content)', () => {
  const bottom: Rect = { x: 12, y: 700, width: 40, height: 44 }
  const top: Rect = { x: 12, y: 60, width: 40, height: 44 }

  it('rises from the bottom half and drops in from the top half', () => {
    expect(anchorRise(bottom, 800)).toBe(24)
    expect(anchorRise(top, 800)).toBe(-16)
  })

  it('falls back to the default rise when the anchor is missing or unusable', () => {
    expect(anchorRise(undefined, 800)).toBe(24)
    expect(anchorRise({ ...bottom, x: Number.NaN }, 800)).toBe(24)
    expect(anchorRise(bottom, 0)).toBe(24)
    expect(anchorRise(bottom, Number.NaN)).toBe(24)
  })
})

describe('shared frame tween (pattern b/e: thumbnail to full view)', () => {
  const thumb: Rect = { x: 20, y: 600, width: 80, height: 80 }
  const full: Rect = { x: 0, y: 0, width: 400, height: 400 }

  it('is the identity at progress 0 and lands on the target at progress 1', () => {
    expect(sharedFrame(thumb, full, 0)).toEqual({ translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 })
    const end = sharedFrame(thumb, full, 1)
    expect(end.translateX).toBe(-20)
    expect(end.translateY).toBe(-600)
    expect(end.scaleX).toBe(5)
    expect(end.scaleY).toBe(5)
  })

  it('interpolates monotonically and clamps out-of-range progress', () => {
    const quarter = sharedFrame(thumb, full, 0.25)
    expect(quarter.translateY).toBe(-150)
    expect(quarter.scaleY).toBe(2)
    expect(sharedFrame(thumb, full, -1)).toEqual(sharedFrame(thumb, full, 0))
    expect(sharedFrame(thumb, full, 2)).toEqual(sharedFrame(thumb, full, 1))
  })

  it('refuses to divide by a zero-size start frame', () => {
    expect(sharedFrame({ ...thumb, width: 0 }, full, 1)).toEqual({ translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 })
  })
})

describe('segmented indicator geometry (pattern g)', () => {
  it('splits an inset track into two equal segments', () => {
    expect(indicatorGeometry(0, 206, 3)).toEqual({ x: 3, width: 100 })
    expect(indicatorGeometry(1, 206, 3)).toEqual({ x: 103, width: 100 })
  })

  it('collapses to zero width before the track measures', () => {
    expect(indicatorGeometry(0, 0, 3)).toEqual({ x: 3, width: 0 })
    expect(indicatorGeometry(1, Number.NaN, 3).width).toBe(0)
    expect(indicatorGeometry(0, 4, 3).width).toBe(0)
  })
})
