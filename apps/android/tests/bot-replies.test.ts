import { describe, expect, it } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { parseBotReplies, parseBotReplyPayload } from '../src/screens/bot/replies'

// Shapes mirror ds-bot/src/host/groups.js round.replies entries.
const message = (text: string) => ({ botId: 'session-1', name: 'Chief', color: 'deepseek', text, time: 1 })
const round = (replies: unknown[]) => JSON.stringify({ replies, passed: replies.length })

describe('Bot room reply extraction', () => {
  it('accepts every compatible detail shape for the same ds-bot round payload', async () => {
    await runScenarios([
      { name: 'plain round result', detail: round([message('结论：通道常驻'), { kind: 'user', text: '收到', time: 2 }]), expected: 2 },
      { name: 'status entries without text', detail: round([{ kind: 'working', botId: 'b', name: 'Monitor', time: 1 }]), expected: 1, first: { kind: 'working' } },
      { name: 'double-encoded text envelope', detail: JSON.stringify({ type: 'text', text: round([message('x')]) }), expected: 1 },
      { name: 'content block envelope', detail: JSON.stringify({ content: [{ type: 'tool-result', content: [{ type: 'text', text: round([message('x')]) }] }] }), expected: 1 },
      { name: 'prose around the payload', detail: `工具输出：\n${round([message('x')])}`, expected: 1 },
      {
        name: 'truncated array keeps only complete entries',
        detail: `{"replies":[${JSON.stringify(message('x'.repeat(2000)))},${JSON.stringify(message('y')).slice(0, 20)}`,
        expected: 1,
      },
      { name: 'non-object entries are dropped', detail: round([1, 'x', message('x')]), expected: 1 },
      { name: 'ordinary tool output', detail: JSON.stringify({ ok: true, lines: ['a', 'b'] }), expected: 0 },
      { name: 'plain prose', detail: '没有可解析的回复', expected: 0 },
      { name: 'embedded replies keyword without valid entries', detail: '示例：{"replies":[1,{"nope":true}],"passed":2}', expected: 0 },
      { name: 'empty replies array', detail: round([]), expected: 0 },
      { name: 'deep untrusted content stays on ordinary tool renderer', detail: '{"content":['.repeat(4500) + '{}' + ']}'.repeat(4500), expected: 0 },
      { name: 'salvage stops at replies boundary', detail: `${round([message('x')]).slice(0, -1)},"meta":{"text":"not a reply"}} trailing`, expected: 1 },
      { name: 'salvage rejects nested array entries', detail: `{"replies":[[${JSON.stringify(message('x'))}]]} trailing`, expected: 0 },
      { name: 'salvage rejects missing entry separators', detail: `{"replies":[${JSON.stringify(message('x'))}{"text":"invalid"}`, expected: 1 },
    ].map(row => ({ name: row.name, run: async () => {
      const replies = parseBotReplies(row.detail)
      expect(replies?.length ?? 0).toBe(row.expected)
      if (row.expected > 0) expect(replies![0]).toMatchObject(row.first ?? { name: 'Chief' })
    } })))
  })
})

/**
 * Contract with the Host compact projection (`packages/plugin/src/compact-bot-round.ts`):
 * the payload stays `{"replies":[...]}` and only adds a `truncated` flag, so the
 * client can tell a whole round from a prefix without a new wire format.
 */
const hostCompacted = JSON.stringify({
  replies: [
    { botId: 'session-1', name: 'Chief', text: '甲'.repeat(2048), time: 1 },
    { botId: 'session-1', name: 'Monitor', text: '乙'.repeat(2048), time: 1 },
    { botId: 'session-1', name: 'Scribe', text: '丙'.repeat(2048), time: 1 },
  ],
  passed: 5,
  truncated: true,
})

describe('Bot reply payload completeness', () => {
  it('distinguishes whole, Host-truncated and salvaged-prefix payloads', async () => {
    await runScenarios([
      {
        name: 'whole round',
        detail: round([message('x'), message('y')]),
        run: (payload: ReturnType<typeof parseBotReplyPayload>) => {
          expect(payload).toMatchObject({ complete: true, truncated: false })
          expect(payload?.rows).toHaveLength(2)
        },
      },
      {
        name: 'Host structural projection with a capped round',
        detail: hostCompacted,
        run: (payload: ReturnType<typeof parseBotReplyPayload>) => {
          expect(payload).toMatchObject({ complete: true, truncated: true })
          expect(payload?.rows.map(row => row.name)).toEqual(['Chief', 'Monitor', 'Scribe'])
          expect(payload?.rows.every(row => (row.text as string).length === 2048)).toBe(true)
        },
      },
      {
        name: 'salvaged prefix keeps only closed entries and is incomplete',
        detail: `{"replies":[${JSON.stringify(message('x'.repeat(2000)))},${JSON.stringify(message('y')).slice(0, 20)}`,
        run: (payload: ReturnType<typeof parseBotReplyPayload>) => {
          expect(payload).toMatchObject({ complete: false, truncated: false })
          expect(payload?.rows).toHaveLength(1)
        },
      },
      {
        name: 'content-block envelope is a whole round',
        detail: JSON.stringify({ content: [{ type: 'tool-result', content: [{ type: 'text', text: round([message('x')]) }] }] }),
        run: (payload: ReturnType<typeof parseBotReplyPayload>) => {
          expect(payload).toMatchObject({ complete: true, truncated: false })
          expect(payload?.rows).toHaveLength(1)
        },
      },
      {
        name: 'empty replies array is a whole empty payload',
        detail: round([]),
        run: (payload: ReturnType<typeof parseBotReplyPayload>) => {
          expect(payload).toMatchObject({ complete: true, truncated: false })
          expect(payload?.rows).toHaveLength(0)
        },
      },
      {
        name: 'ordinary tool output has no payload',
        detail: JSON.stringify({ ok: true, lines: ['a'] }),
        run: (payload: ReturnType<typeof parseBotReplyPayload>) => expect(payload).toBeUndefined(),
      },
    ].map(row => ({ name: row.name, run: async () => row.run(parseBotReplyPayload(row.detail)) })))
    // The legacy accessor stays a thin wrapper for callers that only need rows.
    expect(parseBotReplies(hostCompacted)).toHaveLength(3)
  })
})
