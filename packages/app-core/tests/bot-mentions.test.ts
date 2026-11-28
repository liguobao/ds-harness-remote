import { describe, expect, it } from 'vitest'
import { botMentionSpans, linkBotMentions } from '../src/screens/bot/mentions'
import type { BotEntry } from '../src/services/bot-catalog'

const bot = (id: string, name: string) => ({ id, name } as BotEntry)
const roster = [bot('probe', 'Probe'), bot('chief', 'Chief'), bot('chief-of-staff', 'Chief of Staff')]

describe('where a message mentions a Bot', () => {
  it('finds the name and keeps the text around it', () => {
    const spans = botMentionSpans('@Probe 1+1 is 2.', roster)
    expect(spans).toHaveLength(1)
    expect(spans[0]!.start).toBe(0)
    expect(spans[0]!.end).toBe(6)
    expect(spans[0]!.bot.id).toBe('probe')
  })

  it('prefers the longest name that fits', () => {
    const spans = botMentionSpans('@Chief of Staff please', roster)
    expect(spans[0]!.bot.id).toBe('chief-of-staff')
    expect(spans[0]!.end).toBe(15)
  })

  it('leaves code, links and addresses alone', () => {
    expect(botMentionSpans('`@Probe`', roster)).toHaveLength(0)
    expect(botMentionSpans('mail me@Probe.example', roster)).toHaveLength(0)
    expect(botMentionSpans('[@Probe](https://example.com)', roster)).toHaveLength(0)
    expect(botMentionSpans('[see](https://example.com) @Probe (done)', roster)).toHaveLength(1)
  })

  it('recognizes group-wide @all aliases', () => {
    const spans = botMentionSpans('@all @everyone @所有人 @全体 please check', roster)
    expect(spans.map(span => ({ id: span.bot.id, kind: span.kind, label: span.bot.name }))).toEqual([
      { id: 'all', kind: 'all', label: 'all' },
      { id: 'all', kind: 'all', label: 'everyone' },
      { id: 'all', kind: 'all', label: '所有人' },
      { id: 'all', kind: 'all', label: '全体' },
    ])
    expect(botMentionSpans('@alligator ignore', roster)).toHaveLength(0)
  })

  it('skips the sender itself', () => {
    expect(botMentionSpans('@Probe hi', roster, 'probe')).toHaveLength(0)
    expect(botMentionSpans('@Chief hi', roster, 'probe')).toHaveLength(1)
  })

  it('links the same spans it hands to the renderer without turning @all into a bots.local URL', () => {
    expect(linkBotMentions('@Probe 1+1 is 2.', roster)).toBe('[@Probe](https://bots.local/probe) 1+1 is 2.')
    expect(linkBotMentions('@all please review with @Probe', roster)).toBe('**@all** please review with [@Probe](https://bots.local/probe)')
    expect(linkBotMentions('@everyone check', roster)).toBe('**@everyone** check')
  })
})
