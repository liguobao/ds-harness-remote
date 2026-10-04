import { describe, expect, it } from 'vitest'
import { loadTranscriptEvents, cleanUserPrompt } from '../src/acp/adapters/antigravity/transcript-loader.js'

describe('TranscriptLoader', () => {
  it('cleans user prompt wrapper tags', () => {
    const raw = '<USER_REQUEST>\n这个主机咋样\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\n...'
    expect(cleanUserPrompt(raw)).toBe('这个主机咋样')
    expect(cleanUserPrompt('普通问题')).toBe('普通问题')
  })

  it('hydrates events from real local transcript file', async () => {
    const events = await loadTranscriptEvents(
      'bab821dd-6184-43f1-8ed5-fe589be9b302',
      'cursor:bab821dd-6184-43f1-8ed5-fe589be9b302',
    )
    if (events.length > 0) {
      expect(events.length).toBeGreaterThan(0)
      const types = events.map(e => e.event.type)
      expect(types).toContain('user/message')
      expect(types).toContain('assistant/message')
      const user = events.find(e => e.event.type === 'user/message')
      expect((user?.event?.data as any)?.content?.[0]?.text).toBe('这个主机咋样')
    }
  })

  it('discovers existing Antigravity sessions from brain directory', async () => {
    const { discoverAntigravitySessions } = await import('../src/acp/adapters/antigravity/transcript-loader.js')
    const list = await discoverAntigravitySessions('/var/lib/dsh/workspace/ds-harness-remote', 10)
    expect(Array.isArray(list)).toBe(true)
    if (list.length > 0) {
      expect(typeof list[0].conversationId).toBe('string')
      expect(typeof list[0].title).toBe('string')
      expect(list[0].title.length).toBeGreaterThan(0)
    }
  })
})
