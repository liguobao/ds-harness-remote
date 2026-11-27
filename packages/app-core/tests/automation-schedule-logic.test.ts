import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CRON_EXPRESSION,
  MONTHLY_CRON,
  monthlyCron,
  nextDailyAt,
  nextPresetRuns,
  parseMonthlyCron,
} from '../src/screens/automation-schedule-logic'

describe('monthlyCron / parseMonthlyCron round trip', () => {
  it('builds a monthly expression from a HH:mm time', () => {
    expect(monthlyCron('18:00')).toBe('0 18 1 * *')
    expect(monthlyCron('00:30')).toBe('30 0 1 * *')
    expect(monthlyCron('09:05')).toBe('5 9 1 * *')
  })

  it('round trips every valid time of the default preset domain', () => {
    for (let hour = 0; hour <= 23; hour += 1) {
      for (let minute = 0; minute <= 59; minute += 1) {
        const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
        const expression = monthlyCron(time)
        expect(MONTHLY_CRON.test(expression)).toBe(true)
        expect(parseMonthlyCron(expression)).toBe(time)
      }
    }
  })

  it('parses the default expression and rejects non-monthly shapes', () => {
    expect(parseMonthlyCron(DEFAULT_CRON_EXPRESSION)).toBe('09:00')
    expect(parseMonthlyCron('0 9 * * *')).toBeNull()
    expect(parseMonthlyCron('30 18 1 * *')).toBe('18:30')
    expect(parseMonthlyCron('60 18 1 * *')).toBeNull()
    expect(parseMonthlyCron('30 24 1 * *')).toBeNull()
    expect(parseMonthlyCron('30 18 2 * *')).toBeNull()
  })

  it('trims surrounding whitespace before matching', () => {
    expect(parseMonthlyCron('  0 9 1 * *  ')).toBe('09:00')
  })
})

describe('nextPresetRuns', () => {
  it('skips a monthly run already past today and lands on the next month', () => {
    // 2026-12-01 20:00 local; monthly run at 18:00 today is already past.
    const now = new Date(2026, 11, 1, 20, 0, 0, 0)
    const runs = nextPresetRuns({ preset: 'monthly', time: '18:00', weekdays: [], delayMinutes: 15, now })
    expect(runs.map(d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`)).toEqual([
      '2027-1-1',
      '2027-2-1',
      '2027-3-1',
    ])
    expect(runs[0]!.getHours()).toBe(18)
  })

  it('keeps today when the monthly time is still ahead', () => {
    const now = new Date(2026, 11, 1, 7, 0, 0, 0)
    const runs = nextPresetRuns({ preset: 'monthly', time: '18:00', weekdays: [], delayMinutes: 15, now })
    expect(runs[0]!.getFullYear()).toBe(2026)
    expect(runs[0]!.getMonth()).toBe(11)
    expect(runs[0]!.getDate()).toBe(1)
  })

  it('rolls 12-31 into the next year', () => {
    const now = new Date(2026, 11, 31, 23, 59, 0, 0)
    const runs = nextPresetRuns({ preset: 'monthly', time: '00:30', weekdays: [], delayMinutes: 15, now })
    expect(runs.map(d => `${d.getFullYear()}-${d.getMonth() + 1}`)).toEqual(['2027-1', '2027-2', '2027-3'])
  })

  it('filters weekly runs to the chosen ISO weekdays', () => {
    // 2026-11-27 is a Friday.
    const now = new Date(2026, 10, 27, 8, 0, 0, 0)
    const runs = nextPresetRuns({ preset: 'weekly', time: '09:00', weekdays: [1, 3, 5], delayMinutes: 15, now })
    expect(runs.map(d => d.getDay())).toEqual([5, 1, 3])
    expect(runs.every(d => d.getTime() > now.getTime())).toBe(true)
  })

  it('uses Mon-Fri for the workdays preset', () => {
    const now = new Date(2026, 10, 27, 8, 0, 0, 0)
    const runs = nextPresetRuns({ preset: 'workdays', time: '09:00', weekdays: [6, 7], delayMinutes: 15, now })
    expect(runs.map(d => d.getDay())).toEqual([5, 1, 2])
  })

  it('runs daily at the same time on consecutive days', () => {
    const now = new Date(2026, 10, 27, 10, 0, 0, 0)
    const runs = nextPresetRuns({ preset: 'daily', time: '09:00', weekdays: [], delayMinutes: 15, now })
    expect(runs.map(d => `${d.getMonth() + 1}-${d.getDate()}`)).toEqual(['11-28', '11-29', '11-30'])
  })

  it('counts fixed offsets for hourly, minutely and once', () => {
    const now = new Date(2026, 0, 1, 12, 0, 0, 0)
    const hourly = nextPresetRuns({ preset: 'hourly', time: '', weekdays: [], delayMinutes: 15, now })
    expect(hourly.map(d => d.getHours())).toEqual([13, 14, 15])
    const minutely = nextPresetRuns({ preset: 'minutely', time: '', weekdays: [], delayMinutes: 15, now })
    expect(minutely.map(d => d.getMinutes())).toEqual([1, 2, 3])
    const once = nextPresetRuns({ preset: 'once', time: '', weekdays: [], delayMinutes: 30, now })
    expect(once[0]?.getTime()! - now.getTime()).toBe(30 * 60_000)
  })
})

describe('nextDailyAt', () => {
  it('keeps a midnight time on the next day', () => {
    const now = new Date(2026, 10, 27, 22, 0, 0, 0)
    const next = nextDailyAt('00:30', now)
    expect(`${next.getMonth() + 1}-${next.getDate()}`).toBe('11-28')
    expect(next.getHours()).toBe(0)
    expect(next.getMinutes()).toBe(30)
  })

  it('uses today when the time is still ahead', () => {
    const now = new Date(2026, 10, 27, 6, 0, 0, 0)
    const next = nextDailyAt('08:15', now)
    expect(next.getDate()).toBe(27)
    expect(`${next.getHours()}:${next.getMinutes()}`).toBe('8:15')
  })

  it('advances exactly one day when the time equals now', () => {
    const now = new Date(2026, 10, 27, 9, 30, 0, 0)
    const next = nextDailyAt('09:30', now)
    expect(next.getDate()).toBe(28)
  })

  it('reproduces the DS-Bot single-run midnight fix (no 09:00 fallback)', () => {
    // Old bug: parseInt('00') || 9 coerced 00:30 to 09:30.
    const now = new Date(2026, 10, 27, 12, 0, 0, 0)
    const next = nextDailyAt('00:30', now)
    expect(next.getHours()).toBe(0)
    expect(next.getMinutes()).toBe(30)
    expect(next.getTime()).toBeGreaterThan(now.getTime())
  })
})
