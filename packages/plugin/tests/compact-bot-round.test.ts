import { describe, expect, it } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { compactBotRound, COMPACT_BOT_ROUND_LIMITS as LIMITS } from '../src/compact-bot-round.js'

// Shapes mirror ds-bot/src/host/groups.js round.replies entries.
const reply = (text: string, overrides: Record<string, unknown> = {}) => ({
  botId: 'session-1', name: 'Chief', color: 'deepseek', text, time: 1, ...overrides,
})
const round = (replies: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ replies, passed: replies.length, ...extra })

function parsed(value: string | undefined) {
  expect(value).toBeDefined()
  expect(value!.length).toBeLessThanOrEqual(LIMITS.payload)
  return JSON.parse(value!) as { replies: Record<string, unknown>[]; passed?: number; failed?: number; truncated?: boolean }
}

describe('compact group round projection', () => {
  it('keeps every recognised reply parseable inside the payload budget', async () => {
    await runScenarios([
      {
        name: 'one long reply keeps its speaker and a bounded body',
        run: () => {
          const result = parsed(compactBotRound(round([reply('x'.repeat(3000))])))
          expect(result.replies).toHaveLength(1)
          expect(result.replies[0]).toMatchObject({ botId: 'session-1', name: 'Chief', time: 1 })
          expect((result.replies[0]!.text as string).length).toBe(LIMITS.text)
          expect(result.truncated).toBe(true)
          expect(result.passed).toBe(1)
        },
      },
      {
        name: 'three typical replies stay whole and ordered without a truncation flag',
        run: () => {
          const value = compactBotRound(round([
            reply('a'.repeat(500), { name: 'Chief' }),
            reply('b'.repeat(500), { name: 'Monitor' }),
            { kind: 'user', text: 'c'.repeat(400), time: 2 },
          ]))
          const result = parsed(value)
          expect(result.replies.map(item => item.name ?? item.kind)).toEqual(['Chief', 'Monitor', 'user'])
          expect(result.replies.map(item => (item.text as string)[0])).toEqual(['a', 'b', 'c'])
          expect(result.truncated).toBeUndefined()
        },
      },
      {
        name: 'trailing replies are dropped at the entry ceiling',
        run: () => {
          const source = Array.from({ length: 100 }, (_, index) => reply(`reply-${index}`, { time: index }))
          const result = parsed(compactBotRound(round(source)))
          expect(result.replies).toHaveLength(LIMITS.entries)
          expect(result.replies[0]!.text).toBe('reply-0')
          expect(result.replies.at(-1)!.text).toBe(`reply-${LIMITS.entries - 1}`)
          expect(result.truncated).toBe(true)
        },
      },
      {
        name: 'a single oversized detail is bounded, not discarded',
        run: () => {
          const value = compactBotRound(round([reply('y'.repeat(LIMITS.source - 100))]))
          const result = parsed(value)
          expect(result.replies).toHaveLength(1)
          expect((result.replies[0]!.text as string).length).toBe(LIMITS.text)
        },
      },
      {
        name: 'prose around the payload is tolerated',
        run: () => {
          const result = parsed(compactBotRound(`工具输出：\n${round([reply('x')])}`))
          expect(result.replies).toHaveLength(1)
        },
      },
      {
        name: 'unknown fields, colours and prototype keys are not forwarded',
        run: () => {
          const entryJson = `${JSON.stringify(reply('x')).slice(0, -1)},"colour":"pink","__proto__":{"polluted":true}}`
          const result = parsed(compactBotRound(`{"replies":[${entryJson}],"passed":1,"meta":{"secret":"x"}}`))
          const entry = result.replies[0]!
          expect(Object.keys(entry).sort()).toEqual(['botId', 'name', 'text', 'time'])
          expect(Object.getPrototypeOf(entry)).toBe(Object.prototype)
          expect(({} as Record<string, unknown>).polluted).toBeUndefined()
          expect(result).not.toHaveProperty('meta')
        },
      },
      {
        name: 'status entries without text keep their kind',
        run: () => {
          const result = parsed(compactBotRound(round([{ kind: 'working', botId: 'b', name: 'Monitor', time: 1 }])))
          expect(result.replies[0]).toMatchObject({ kind: 'working', name: 'Monitor' })
        },
      },
      {
        name: 'identity projection is idempotent',
        run: () => {
          const once = compactBotRound(round([reply('x'.repeat(3000)), reply('short', { name: 'Monitor' })]))!
          expect(compactBotRound(once)).toBe(once)
        },
      },
      {
        name: 'an upstream truncated flag survives a second projection',
        run: () => {
          const once = compactBotRound(round([reply('x')], { truncated: true }))!
          expect(parsed(once).truncated).toBe(true)
          expect(compactBotRound(once)).toBe(once)
        },
      },
      {
        name: 'non-round payloads stay on the ordinary renderer',
        run: () => {
          for (const detail of [
            round([]),
            '{"replies":[[{"text":"nested"}]]}',
            '{"replies":[1,"x",{"nope":true}]}',
            '{"ok":true,"lines":["a","b"]}',
            '{"replies":[{"text":"cut"}',
            'x'.repeat(LIMITS.scan + 1) + '{"replies":[{"text":"too late"}]}',
            'z'.repeat(1024 * 1024 + 1) + '{"replies":[{"text":"too large"}]}',
            '没有可解析的回复',
          ]) {
            expect(compactBotRound(detail)).toBeUndefined()
          }
        },
      },
    ].map(row => ({ name: row.name, run: async () => row.run() })))
  })
})
