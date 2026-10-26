import { describe, expect, it } from 'vitest'
import {
  CLOSE_MIN_DX,
  OPEN_MIN_DX,
  SWIPE_OPEN_EDGE_MAX,
  SWIPE_OPEN_EDGE_MIN,
  clampDrawerTranslate,
  shouldConfirmSwipeLeftClose,
  shouldConfirmSwipeRightOpen,
  shouldStartSwipeLeftToClose,
  shouldStartSwipeRightToOpen,
} from '../src/lib/gesture-swipe-rules'

describe('swipe drawer navigation gesture rules (production module imports)', () => {
  describe('shouldStartSwipeRightToOpen (Phase 1: Claim gesture)', () => {
    it('claims responder when swiping right in valid edge band', () => {
      expect(shouldStartSwipeRightToOpen({ dx: 40, dy: 4, x0: 30 }, false)).toBe(true)
      expect(shouldStartSwipeRightToOpen({ dx: 50, dy: 10, x0: 120 }, false)).toBe(true)
      expect(shouldStartSwipeRightToOpen({ dx: 45, dy: 5, x0: SWIPE_OPEN_EDGE_MAX }, false)).toBe(true)
    })

    it('rejects gesture in system edge return band (< 20px) to prevent Android system back conflict', () => {
      expect(shouldStartSwipeRightToOpen({ dx: 40, dy: 4, x0: 10 }, false)).toBe(false)
      expect(shouldStartSwipeRightToOpen({ dx: 40, dy: 4, x0: SWIPE_OPEN_EDGE_MIN - 1 }, false)).toBe(false)
    })

    it('rejects gesture beyond edge boundary (> 240px) to prevent message content conflict', () => {
      expect(shouldStartSwipeRightToOpen({ dx: 40, dy: 4, x0: SWIPE_OPEN_EDGE_MAX + 1 }, false)).toBe(false)
      expect(shouldStartSwipeRightToOpen({ dx: 100, dy: 5, x0: 300 }, false)).toBe(false)
    })

    it('rejects gesture in trajectory mode', () => {
      expect(shouldStartSwipeRightToOpen({ dx: 40, dy: 4, x0: 30 }, true)).toBe(false)
    })

    it('rejects vertical scrolling or insufficient distance', () => {
      expect(shouldStartSwipeRightToOpen({ dx: 40, dy: 60, x0: 30 }, false)).toBe(false)
      expect(shouldStartSwipeRightToOpen({ dx: OPEN_MIN_DX - 1, dy: 0, x0: 30 }, false)).toBe(false)
      expect(shouldStartSwipeRightToOpen({ dx: -40, dy: 0, x0: 30 }, false)).toBe(false)
    })
  })

  describe('shouldConfirmSwipeRightOpen (Phase 2: Release to open)', () => {
    it('confirms open when distance is above threshold with valid slope', () => {
      expect(shouldConfirmSwipeRightOpen({ dx: 50, dy: 5, x0: 30 })).toBe(true)
      expect(shouldConfirmSwipeRightOpen({ dx: 120, dy: 10, x0: 30 })).toBe(true)
    })

    it('confirms open with high velocity even if distance is moderate', () => {
      expect(shouldConfirmSwipeRightOpen({ dx: 25, dy: 2, x0: 30, vx: 0.5 })).toBe(true)
    })

    it('rejects reverse or vertical drag', () => {
      expect(shouldConfirmSwipeRightOpen({ dx: -40, dy: 0, x0: 30 })).toBe(false)
      expect(shouldConfirmSwipeRightOpen({ dx: 60, dy: 80, x0: 30 })).toBe(false)
    })
  })

  describe('shouldStartSwipeLeftToClose (Phase 1: Drawer left swipe claim)', () => {
    it('claims responder on clear horizontal swipe left', () => {
      expect(shouldStartSwipeLeftToClose({ dx: -40, dy: 4, x0: 300 })).toBe(true)
      expect(shouldStartSwipeLeftToClose({ dx: -50, dy: 10, x0: 100 })).toBe(true)
    })

    it('rejects right swipe or dominant vertical gesture', () => {
      expect(shouldStartSwipeLeftToClose({ dx: 40, dy: 4, x0: 300 })).toBe(false)
      expect(shouldStartSwipeLeftToClose({ dx: -40, dy: 60, x0: 300 })).toBe(false)
    })
  })

  describe('shouldConfirmSwipeLeftClose (Phase 2: Release to close)', () => {
    it('confirms close when swipe exceeds distance or velocity threshold', () => {
      expect(shouldConfirmSwipeLeftClose({ dx: -CLOSE_MIN_DX - 10, dy: 0, x0: 300 })).toBe(true)
      expect(shouldConfirmSwipeLeftClose({ dx: -35, dy: 5, x0: 300, vx: -0.6 })).toBe(true)
    })

    it('rejects close when distance and velocity are insufficient (triggers spring back)', () => {
      expect(shouldConfirmSwipeLeftClose({ dx: -15, dy: 0, x0: 300 })).toBe(false)
      expect(shouldConfirmSwipeLeftClose({ dx: 20, dy: 0, x0: 300 })).toBe(false)
    })
  })

  describe('clampDrawerTranslate (Boundary and reverse handling)', () => {
    it('clamps positive translation smoothly to 0', () => {
      expect(clampDrawerTranslate(20, 360)).toBe(0)
      expect(clampDrawerTranslate(0, 360)).toBe(0)
    })

    it('clamps excessive negative translation to -drawerWidth', () => {
      expect(clampDrawerTranslate(-400, 360)).toBe(-360)
    })

    it('preserves translation in valid range [-drawerWidth, 0]', () => {
      expect(clampDrawerTranslate(-120, 360)).toBe(-120)
      expect(clampDrawerTranslate(-280, 360)).toBe(-280)
    })
  })
})
