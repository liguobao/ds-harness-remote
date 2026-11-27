/**
 * Pure schedule-timing helpers shared by the automation tasks modal and the
 * DS-Bot schedule form. Extracted so generation, parsing and next-run math
 * can be unit-tested without React Native components.
 */

export type SchedulePreset =
  | 'daily'
  | 'workdays'
  | 'weekly'
  | 'monthly'
  | 'hourly'
  | 'minutely'
  | 'once'
  | 'cron'

/** Matches `m h 1 * *` (day 1 of every month, single spaces). */
export const MONTHLY_CRON = /^([0-5]?\d)\s+([01]?\d|2[0-3])\s+1\s+\*\s+\*$/u

export const DEFAULT_CRON_EXPRESSION = '0 9 1 * *'
export const CRON_PLACEHOLDER = '0 9 * * *'

/** Builds the monthly Cron expression `minute hour 1 * *` for a `HH:mm` time. */
export function monthlyCron(time: string): string {
  const [hour, minute] = time.split(':').map(Number)
  return `${minute} ${hour} 1 * *`
}

/**
 * Inverse of {@link monthlyCron}: reads the `HH:mm` time back out of a
 * monthly Cron expression, or returns null when the expression does not use
 * the monthly preset shape.
 */
export function parseMonthlyCron(expression: string): string | null {
  const match = MONTHLY_CRON.exec(expression.trim())
  if (match === null) return null
  const hour = String(Number(match[2])).padStart(2, '0')
  const minute = String(Number(match[1])).padStart(2, '0')
  return `${hour}:${minute}`
}

function splitTime(time: string): { hours: number; minutes: number } {
  const hours = Number(time.split(':')[0])
  const minutes = Number(time.split(':')[1])
  return { hours, minutes }
}

export interface NextRunsInput {
  preset: Exclude<SchedulePreset, 'cron'>
  time: string
  weekdays: number[]
  delayMinutes: number
  now: Date
}

/**
 * The next three local run times for a preset, mirroring the preview the
 * automation form shows. `workdays`/`weekly` filter by ISO-like weekdays
 * (1=Monday..7=Sunday); `monthly` runs on day 1 of upcoming months.
 */
export function nextPresetRuns(input: NextRunsInput): Date[] {
  const { preset, time, weekdays, delayMinutes, now } = input
  const { hours, minutes } = splitTime(time)
  const stamps: Date[] = []

  if (preset === 'minutely') {
    for (let i = 1; i <= 3; i += 1) stamps.push(new Date(now.getTime() + i * 60_000))
  } else if (preset === 'hourly') {
    for (let i = 1; i <= 3; i += 1) stamps.push(new Date(now.getTime() + i * 3_600_000))
  } else if (preset === 'once') {
    stamps.push(new Date(now.getTime() + delayMinutes * 60_000))
  } else if (preset === 'monthly') {
    for (let i = 0; i <= 3 && stamps.length < 3; i += 1) {
      const candidate = new Date(now)
      candidate.setMonth(now.getMonth() + i, 1)
      candidate.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0)
      if (candidate.getTime() <= now.getTime()) continue
      stamps.push(candidate)
    }
  } else {
    const activeWeekdays = preset === 'workdays' ? [1, 2, 3, 4, 5] : weekdays
    for (let day = 0; day < 21 && stamps.length < 3; day += 1) {
      const candidate = new Date(now)
      candidate.setDate(now.getDate() + day)
      candidate.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0)
      if (candidate.getTime() <= now.getTime()) continue
      if (preset === 'weekly' || preset === 'workdays') {
        const weekday = candidate.getDay() === 0 ? 7 : candidate.getDay()
        if (!activeWeekdays.includes(weekday)) continue
      }
      stamps.push(candidate)
    }
  }
  return stamps
}

/**
 * Next local occurrence of a `HH:mm` time from `now`; used for DS-Bot
 * single-run tasks so a midnight time like 00:30 stays 00:30 tomorrow
 * instead of being coerced to the 09:00 default.
 */
export function nextDailyAt(time: string, now: Date): Date {
  const hh = Number(time.slice(0, 2))
  const mm = Number(time.slice(3))
  const next = new Date(now)
  next.setHours(hh, mm, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next
}
