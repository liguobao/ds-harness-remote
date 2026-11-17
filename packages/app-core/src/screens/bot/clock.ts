// DS-Bot's own stamp rules, ported from ds-bot/src/client/text.js so a reply reads the
// same here as in the Host's chat: today shows the clock alone, an earlier day names
// itself first ("Yesterday 9:03 PM", "Thu, Sep 3 4:20 PM", with the year once it differs).
import { strings } from '../../locales/i18n'

/** The day words DS-Bot translates for "Today {time}" / "Yesterday {time}". */
const DAY_WORDS: Record<string, [string, string]> = {
  'en-US': ['Today', 'Yesterday'],
  'zh-CN': ['今天', '昨天'],
  'zh-TW': ['今天', '昨天'],
  'ja-JP': ['今日', '昨日'],
  'de-DE': ['Heute', 'Gestern'],
  'fr-FR': ["Aujourd’hui", 'Hier'],
  'es-ES': ['Hoy', 'Ayer'],
  'ru-RU': ['Сегодня', 'Вчера'],
  'uk-UA': ['Сьогодні', 'Учора'],
}

function dayWords(): [string, string] {
  return DAY_WORDS[strings.time.locale] ?? DAY_WORDS['en-US']!
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(strings.time.locale, { hour: 'numeric', minute: '2-digit' })
}

const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
const daysBefore = (date: Date, now: number) => Math.round((midnight(new Date(now)) - midnight(date)) / 86_400_000)

/** "Today 1:12 AM", "Yesterday 9:03 PM", "Thu, Sep 3 4:20 PM". */
export function botClockLabel(time: number, now = Date.now()): string {
  const date = new Date(time)
  const days = daysBefore(date, now)
  const stamp = clock(time)
  const [today, yesterday] = dayWords()
  if (days === 0) return `${today} ${stamp}`
  if (days === 1) return `${yesterday} ${stamp}`
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  const day = date.toLocaleDateString(strings.time.locale, {
    weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' } as const),
  })
  return `${day} ${stamp}`
}

/** A message's own stamp: today only the clock, an earlier day named as a separator would. */
export function botMessageClock(time: number, now = Date.now()): string {
  return daysBefore(new Date(time), now) === 0 ? clock(time) : botClockLabel(time, now)
}
