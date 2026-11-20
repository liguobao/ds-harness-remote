import { describe, expect, it } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import {
  finishSheetExit,
  motionTokens,
  nextSheetPhase,
  sheetPhaseDuration,
  type SheetPhase,
} from '../src/ui/motion'

const PHASES: SheetPhase[] = ['unmounted', 'opening', 'open', 'closing', 'dismissing']

describe('sheet visibility state machine', () => {
  it('enters from settled states and never skips the closing phase', () => {
    expect(nextSheetPhase('unmounted', true)).toBe('opening')
    expect(nextSheetPhase('closing', true)).toBe('opening')
    expect(nextSheetPhase('opening', false)).toBe('closing')
    expect(nextSheetPhase('open', false)).toBe('closing')
    expect(nextSheetPhase('closing', false)).toBe('closing')
    expect(nextSheetPhase('unmounted', false)).toBe('unmounted')
  })

  it('keeps in-flight phases stable while the target state is unchanged', () => {
    expect(nextSheetPhase('opening', true)).toBe('opening')
    expect(nextSheetPhase('open', true)).toBe('open')
  })

  it('settles every phase into a terminal state under repeated toggles', () => {
    const run = (sequence: boolean[]): SheetPhase => {
      let phase: SheetPhase = 'unmounted'
      for (const visible of sequence) {
        phase = nextSheetPhase(phase, visible)
        // Model the animation callback that settles in-flight phases.
        if (phase === 'opening' && !visible) phase = 'closing'
      }
      return phase
    }
    // Rapid open/close bursts always end in a state the sheet can render.
    expect(run([true, false, true, false, true])).toBe('opening')
    expect(run([true, true, false, false])).toBe('closing')
    expect(run([])).toBe('unmounted')
    // Every phase in the matrix has a defined successor.
    for (const phase of PHASES) {
      for (const visible of [true, false]) {
        expect(PHASES).toContain(nextSheetPhase(phase, visible))
      }
    }
  })

  it('unmounts a sheet immediately only when superseded by another sheet or route jump', () => {
    expect(nextSheetPhase('closing', false, true)).toBe('unmounted')
    expect(nextSheetPhase('closing', false, false)).toBe('closing')
    expect(nextSheetPhase('open', false, true)).toBe('unmounted')
    expect(nextSheetPhase('opening', false, true)).toBe('unmounted')
    expect(nextSheetPhase('closing', true, true)).toBe('opening')
  })

  it('uses a slower entry than exit, and caps reduced motion without slowing a faster exit', () => {
    expect(sheetPhaseDuration('opening', false)).toBe(motionTokens.duration.sheet)
    expect(sheetPhaseDuration('closing', false)).toBe(motionTokens.duration.sheetExit)
    expect(sheetPhaseDuration('opening', false)).toBeGreaterThan(sheetPhaseDuration('closing', false))
    expect(sheetPhaseDuration('opening', true)).toBe(motionTokens.duration.reduced)
    expect(sheetPhaseDuration('closing', true)).toBe(Math.min(motionTokens.duration.sheetExit, motionTokens.duration.reduced))
    expect(sheetPhaseDuration('closing', true)).toBeLessThanOrEqual(motionTokens.duration.sheetExit)
  })

  it('handles iOS native dismissing and finishSheetExit across Android and iOS', async () => {
    await runScenarios([
      {
        name: 'finishSheetExit settles closing to unmounted on Android and dismissing on iOS',
        run: () => {
          expect(finishSheetExit('closing')).toBe('unmounted')
          expect(finishSheetExit('closing', false)).toBe('unmounted')
          expect(finishSheetExit('closing', true)).toBe('dismissing')

          for (const phase of PHASES) {
            if (phase === 'closing') continue
            expect(finishSheetExit(phase, false)).toBe(phase)
            expect(finishSheetExit(phase, true)).toBe(phase)
          }
        },
      },
      {
        name: 'dismissing blocks reopen until settled to unmounted',
        run: () => {
          for (const superseded of [false, true]) {
            for (const waitForNativeDismiss of [false, true]) {
              expect(nextSheetPhase('dismissing', true, superseded, waitForNativeDismiss)).toBe('dismissing')
              expect(nextSheetPhase('dismissing', false, superseded, waitForNativeDismiss)).toBe('dismissing')
            }
          }
          expect(nextSheetPhase('unmounted', true, false, true)).toBe('opening')
        },
      },
      {
        name: 'superseded hide enters dismissing on iOS and unmounted on Android',
        run: () => {
          for (const phase of ['opening', 'open', 'closing'] as const) {
            expect(nextSheetPhase(phase, false, true, false)).toBe('unmounted')
            expect(nextSheetPhase(phase, false, true, true)).toBe('dismissing')
            expect(nextSheetPhase(phase, false, false, false)).toBe('closing')
            expect(nextSheetPhase(phase, false, false, true)).toBe('closing')
          }
          expect(nextSheetPhase('unmounted', false, true, true)).toBe('unmounted')
          expect(nextSheetPhase('dismissing', false, true, true)).toBe('dismissing')
        },
      },
      {
        name: 'full phase matrix remains closed under superseded and waitForNativeDismiss flags',
        run: () => {
          for (const phase of PHASES) {
            for (const visible of [true, false]) {
              for (const superseded of [false, true]) {
                for (const waitForNativeDismiss of [false, true]) {
                  expect(PHASES).toContain(
                    nextSheetPhase(phase, visible, superseded, waitForNativeDismiss),
                  )
                }
              }
            }
          }
        },
      },
    ])
  })
})
