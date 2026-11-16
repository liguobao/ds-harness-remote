import type { BotEntry } from '../../services/bot-catalog'

const origin = 'https://bots.local/'

/** Resolve only Bots in the currently connected Host's roster. Never open a URL. */
export function botMentionTarget(href: string, bots: BotEntry[]): string | undefined {
  if (!href.startsWith(origin)) return undefined
  try {
    const id = decodeURIComponent(href.slice(origin.length))
    return bots.find(bot => bot.id === id)?.id
  } catch { return undefined }
}

export interface MentionSpan { start: number; end: number; bot: BotEntry }

/** Where each `@Name` sits in a message, skipping code, links and file references. */
export function botMentionSpans(text: string, bots: BotEntry[], selfId?: string): MentionSpan[] {
  if (!text.includes('@')) return []
  const literal = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|\[[^\]\n]*\]\([^)\n]*\)/g
  const excluded = [...text.matchAll(literal)].map(match => [match.index, match.index + match[0].length])
  const candidates = bots.filter(bot => bot.name).slice().sort((a, b) => b.name.length - a.name.length)
  const spans: MentionSpan[] = []
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    if ((at > 0 && /[a-z0-9_./]/i.test(text[at - 1]!)) || excluded.some(([start, end]) => at >= start! && at < end!)) continue
    const bot = candidates.find(candidate => {
      const end = at + 1 + candidate.name.length
      return text.slice(at + 1, end).toLowerCase() === candidate.name.toLowerCase()
        && !/^(?:[a-z0-9_\-/\\]|\.[a-z0-9_-])/i.test(text.slice(end))
    })
    if (!bot) continue
    const end = at + 1 + bot.name.length
    if (bot.id !== selfId) spans.push({ start: at, end, bot })
    at = end - 1
  }
  return spans
}

/** Match upstream @Name boundaries, keeping code, links and file references literal. */
export function linkBotMentions(text: string, bots: BotEntry[], selfId?: string): string {
  const spans = botMentionSpans(text, bots, selfId)
  if (spans.length === 0) return text
  let result = ''
  let cursor = 0
  for (const span of spans) {
    const label = text.slice(span.start, span.end).replace(/[\[\]\\]/g, '\\$&')
    result += `${text.slice(cursor, span.start)}[${label}](${origin}${encodeURIComponent(span.bot.id)})`
    cursor = span.end
  }
  return result + text.slice(cursor)
}
