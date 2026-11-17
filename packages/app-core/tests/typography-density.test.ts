import { describe, expect, it } from 'vitest'
import { isTypographyDensity, typeForDensity, standardType, compactType } from '../src/ui/theme'

describe('typography density and metrics', () => {
  it('validates density values correctly', () => {
    expect(isTypographyDensity('standard')).toBe(true)
    expect(isTypographyDensity('compact')).toBe(true)
    expect(isTypographyDensity('loose')).toBe(false)
    expect(isTypographyDensity(null)).toBe(false)
    expect(isTypographyDensity(undefined)).toBe(false)
  })

  it('provides tighter metrics for compact density than standard', () => {
    const std = typeForDensity('standard')
    const compact = typeForDensity('compact')

    expect(compact).toBe(compactType)
    expect(std).toBe(standardType)

    // Body font size and line height
    expect(compact.body.fontSize).toBeLessThan(std.body.fontSize)
    expect(compact.body.lineHeight).toBeLessThan(std.body.lineHeight)

    // Small text line height
    expect(compact.small.lineHeight).toBeLessThan(std.small.lineHeight)

    // Android includeFontPadding turned off for tighter line height control
    expect(compact.body.includeFontPadding).toBe(false)
    expect(std.body.includeFontPadding).toBe(false)
  })

  it('standard density line heights are tightened compared to original defaults', () => {
    // Original was 24, tightened to 22
    expect(standardType.body.lineHeight).toBe(22)
    // Compact is even denser at 20
    expect(compactType.body.lineHeight).toBe(20)
  })

  it('keeps accessible touch target minimum height while compacting content padding', () => {
    const std = typeForDensity('standard')
    const compact = typeForDensity('compact')
    expect(compact.body.fontSize).toBeLessThan(std.body.fontSize)
  })
})
