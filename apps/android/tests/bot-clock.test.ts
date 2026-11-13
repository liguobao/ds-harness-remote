import { describe, expect, it } from 'vitest'
import { botClockLabel, botMessageClock, clock } from '../src/screens/bot/clock'

// DS-Bot's rule (ds-bot/src/client/text.js): today shows the clock alone, an earlier day
// names itself first, and a different year is added once it matters.
const now = new Date(2026, 10, 12, 20, 0, 0).getTime() // 12 Nov 2026, 20:00 local
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m, d, h, min).getTime()

describe('a reply stamp follows the Host chat', () => {
  it('shows only the clock for today', () => {
    const time = at(2026, 10, 12, 13, 38)
    expect(botMessageClock(time, now)).toBe(clock(time))
    expect(botMessageClock(time, now)).not.toContain('Today')
  })

  it('names yesterday before the clock', () => {
    const time = at(2026, 10, 11, 21, 3)
    const label = botMessageClock(time, now)
    expect(label).toContain(clock(time))
    expect(label).not.toBe(clock(time))
    expect(label.split(' ').slice(0, -2).join(' ')).not.toBe('')
  })

  it('names the weekday and date for older days, adding the year when it differs', () => {
    const older = botMessageClock(at(2026, 8, 3, 16, 20), now)
    expect(older).toContain(clock(at(2026, 8, 3, 16, 20)))
    const lastYear = botMessageClock(at(2025, 8, 3, 16, 20), now)
    expect(lastYear).toContain(String(new Date(2025, 8, 3).getFullYear()))
  })

  it('treats the day boundary as local midnight, exactly like the Host', () => {
    const justBefore = at(2026, 10, 12, 0, 1)
    const justAfter = at(2026, 10, 11, 23, 59)
    expect(botMessageClock(justBefore, now)).toBe(clock(justBefore))
    expect(botMessageClock(justAfter, now)).not.toBe(clock(justAfter))
    expect(botClockLabel(justBefore, now)).toContain(clock(justBefore))
  })
})
