import { describe, expect, it } from 'vitest'
import {
  LINE_EFFECTS,
  computeLineFxMeta,
  computeLineTransform,
  deriveDuotoneSecondaryColor,
  evaluateLineFxAt,
  impulse,
  resolveMonochromeDuotoneTones,
  scalePath,
  settle,
} from '../src/ui/duotone-motion'

describe('Line-duotone damped-spring motion math and monochrome palette', () => {
  it('evaluates damped spring impulse and settle curves accurately', () => {
    expect(impulse(0)).toBe(0)
    expect(impulse(0.14)).toBeGreaterThan(0.5)
    expect(Math.abs(impulse(3.0))).toBeLessThan(0.05)

    expect(settle(0)).toBe(1)
    expect(Math.abs(settle(3.0))).toBeLessThan(0.05)
    expect(LINE_EFFECTS.rotate.len({ t: 'rotate', deg: 90 }, 1)).toBe(820)
    expect(LINE_EFFECTS.rotate.len({ t: 'rotate', deg: 360 }, 1)).toBe(1050)
  })

  it('computes fx spans, looping flags, and layer poses around 24x24 center', () => {
    const meta = computeLineFxMeta([
      { t: 'wiggle', on: ['body'], o: [12, 3], deg: 8 },
      { t: 'wiggle', on: ['clapper'], o: [12, 3], deg: 11, delay: 50 },
    ])
    expect(meta.span).toBe(1050)
    expect(meta.loops).toBe(false)

    const wifiMeta = computeLineFxMeta({ t: 'variable', on: [['w0'], ['w1'], ['w2']] })
    expect(wifiMeta.loops).toBe(true)

    const pauseMeta = computeLineFxMeta({ t: 'keys', on: ['p1', 'p2'], by: true, ms: 420, sy: 0.72 })
    expect(pauseMeta.span).toBe(420 + 420 + 70)

    const delayedMeta = computeLineFxMeta([
      { t: 'rotate', on: ['sq'], deg: 90, delay: 80 },
      { t: 'keys', on: ['circ'], delay: 160, s: [1.14, 0.94] },
    ])
    expect(delayedMeta.span).toBe(920)
    expect(evaluateLineFxAt({ t: 'rotate', on: ['sq'], deg: 90, delay: 80 }, 50, false).sq?.r).toBe(0)
    expect(evaluateLineFxAt({ t: 'rotate', on: ['sq'], deg: 90, delay: 80 }, 180, false).sq?.r).toBeGreaterThan(0)

    const mid = evaluateLineFxAt({ t: 'rotate', on: ['gear'], deg: 90 }, 200, false)
    expect(mid.gear?.r).toBeGreaterThan(0)
    const tf = computeLineTransform({ r: 45, s: 1.05, o: [12, 12] })
    expect(tf).toBe('translate(12 12) rotate(45) scale(1.05 1.05) translate(-12 -12)')
  })

  it('reshapes path coordinates without scaling stroke width', () => {
    expect(scalePath('M6 12L18 12', 0.5, 1, 12, 12)).toBe('M9 12L15 12')
  })

  it('derives crisp monochrome hierarchical tones across light, dark, inverse, and rgba surfaces', () => {
    expect(deriveDuotoneSecondaryColor('#0F0F0F', '#FFFFFF', 0.42)).toBe('#9A9A9A')
    expect(resolveMonochromeDuotoneTones({ scheme: 'light' })).toEqual({
      primary: '#0F0F0F',
      secondary: '#9A9A9A',
    })
    expect(resolveMonochromeDuotoneTones({ scheme: 'light', inverse: true })).toEqual({
      primary: '#FFFFFF',
      secondary: '#747474',
    })
    expect(resolveMonochromeDuotoneTones({ scheme: 'dark' })).toEqual({
      primary: '#F2F4F7',
      secondary: '#72767B',
    })
    expect(resolveMonochromeDuotoneTones({ scheme: 'dark', inverse: true })).toEqual({
      primary: '#0B0D11',
      secondary: '#919396',
    })
    const darkCardTones = resolveMonochromeDuotoneTones({
      scheme: 'dark',
      surfaceColor: 'rgba(255, 255, 255, 0.05)',
    })
    expect(darkCardTones.primary).toBe('#F2F4F7')
    expect(darkCardTones.secondary).toBe('#77787A')
  })
})
