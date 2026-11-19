import { describe, expect, it } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import {
  aggregateTurnUsage,
  aggregateTurnUsageByTurn,
  processSegments,
  resolveUncachedInputTokens,
  shouldShowTurnResponseActions,
} from '../src/screens/chat-process'
import { applyCursorFrame } from '../src/services/cursor'
import { foldHistory } from '../src/state/event-reducer'
import type { ChatItem, ChatMessage, NativeSessionEvent, ToolActivity } from '../src/types'

function assistant(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    kind: 'message',
    id,
    sessionId: 's1',
    role: 'assistant',
    text: '',
    createdAt: 1000,
    turn: '1',
    replyGroup: '1',
    ...overrides,
  }
}

function tool(id: string, state: ToolActivity['state'] = 'finished'): ToolActivity {
  return {
    kind: 'tool',
    id,
    sessionId: 's1',
    toolName: 'run_command',
    toolKey: 'run_command',
    state,
    createdAt: 1100,
    turn: '1',
  }
}

function event(type: string, seq: number, data: Record<string, unknown>): { event: NativeSessionEvent } {
  return {
    event: { type, seq, time: 1_786_000_000_000 + seq * 1000, data } as NativeSessionEvent,
  }
}

describe('chat process turn footer & usage aggregation', () => {
  it('shows turn actions only on the final response of a settled turn across multi-step scenarios', async () => {
    await runScenarios([
      {
        name: 'completed multi-step turn hides preamble footer and shows final footer',
        run: () => {
          const items: ChatItem[] = [
            assistant('a1', {
              reasoning: '先分析请求',
              text: '我查一下这个名字。',
              turnEnd: { reason: 'completed', time: 3000 },
            }),
            tool('t1', 'finished'),
            assistant('a2', {
              text: '查到了，这是最终结论。',
              turnEnd: { reason: 'completed', time: 3000 },
            }),
          ]
          const segments = processSegments(items)
          const lastResponseIndex = segments.map(s => s.kind).lastIndexOf('response')
          expect(segments.map(s => s.kind)).toEqual(['activity', 'response', 'activity', 'response'])
          expect(shouldShowTurnResponseActions({
            segmentIndex: 1, lastResponseIndex, turnEnded: true, hasActiveItem: false, isTurnRunning: false,
          })).toBe(false)
          expect(shouldShowTurnResponseActions({
            segmentIndex: 3, lastResponseIndex, turnEnded: true, hasActiveItem: false, isTurnRunning: false,
          })).toBe(true)
        },
      },
      {
        name: 'in-flight multi-step turn (including Codex mid-turn preamble) suppresses footer before and during tools',
        run: () => {
          expect(shouldShowTurnResponseActions({
            segmentIndex: 1, lastResponseIndex: 1, turnEnded: false, hasActiveItem: false, isTurnRunning: true,
          })).toBe(false)
          expect(shouldShowTurnResponseActions({
            segmentIndex: 1, lastResponseIndex: 1, turnEnded: false, hasActiveItem: true, isTurnRunning: true,
          })).toBe(false)
        },
      },
      {
        name: 'completed turn ending with tool after text still shows actions on its final response',
        run: () => {
          expect(shouldShowTurnResponseActions({
            segmentIndex: 1, lastResponseIndex: 1, turnEnded: true, hasActiveItem: false, isTurnRunning: false,
          })).toBe(true)
        },
      },
      {
        name: 'historical turn without turnEnd shows actions only on its final response when idle',
        run: () => {
          expect(shouldShowTurnResponseActions({
            segmentIndex: 1, lastResponseIndex: 3, turnEnded: false, hasActiveItem: false, isTurnRunning: false,
          })).toBe(false)
          expect(shouldShowTurnResponseActions({
            segmentIndex: 3, lastResponseIndex: 3, turnEnded: false, hasActiveItem: false, isTurnRunning: false,
          })).toBe(true)
        },
      },
    ])
  })

  it('aggregates usage across folded Harness steps (including silent tool-only steps) and reconciles Harness vs ACP uncached input', async () => {
    await runScenarios([
      {
        name: 'returns undefined when no assistant step carries usage',
        run: () => {
          expect(aggregateTurnUsage([assistant('a1', { text: 'hi' }), tool('t1')])).toBeUndefined()
        },
      },
      {
        name: 'returns the original usage object for a single-step turn',
        run: () => {
          const stepUsage = { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 }
          expect(aggregateTurnUsage([assistant('a1', { text: 'hi', usage: stepUsage })])).toBe(stepUsage)
        },
      },
      {
        name: 'foldHistory retains silent tool-only step usage without rendering a visible message, and breakdown equals totalTokens even under high cache hit',
        run: () => {
          const folded = foldHistory([
            event('turn/start', 1, { turn: 1 }),
            event('assistant/message', 2, {
              turn: 1,
              step: 1,
              message: {
                id: 'a-step-1',
                content: [
                  { type: 'reasoning', text: '先检查工具环境' },
                  { type: 'text', text: '我查一下这个名字。' },
                ],
              },
              usage: { inputTokens: 2_000, cacheReadTokens: 40_000, cacheWriteTokens: 0, outputTokens: 600, reasoningTokens: 400, totalTokens: 42_600 },
            }),
            event('tool/call', 3, { turn: 1, step: 1, callId: 'c1', toolName: 'run_command', toolKey: 'run_command', arguments: '{}' }),
            event('tool/result', 4, { turn: 1, step: 1, callId: 'c1', toolName: 'run_command', toolKey: 'run_command', result: { ok: true } }),
            // Step 2: silent tool-only step with no visible text or reasoning, carrying LLM usage.
            event('assistant/message', 5, {
              turn: 1,
              step: 2,
              message: { id: 'a-step-2-silent', content: [{ type: 'tool-call', callId: 'c2' }] },
              usage: { inputTokens: 500, cacheReadTokens: 45_000, cacheWriteTokens: 200, outputTokens: 300, totalTokens: 46_000 },
            }),
            event('tool/call', 6, { turn: 1, step: 2, callId: 'c2', toolName: 'web_search', toolKey: 'web_search', arguments: '{}' }),
            event('tool/result', 7, { turn: 1, step: 2, callId: 'c2', toolName: 'web_search', toolKey: 'web_search', result: { ok: true } }),
            event('assistant/message', 8, {
              turn: 1,
              step: 3,
              message: { id: 'a-step-3', content: [{ type: 'text', text: '查到了。' }] },
              usage: { inputTokens: 1_500, cacheReadTokens: 50_000, cacheWriteTokens: 0, outputTokens: 900, totalTokens: 52_400 },
            }),
            event('turn/end', 9, { turn: 1, reason: { kind: 'completed' } }),
          ], 's1', true)

          const silentLedger = folded.find(item => item.id === 'a-step-2-silent')
          expect(silentLedger).toMatchObject({ kind: 'message', usageOnly: true })
          const visible = folded.filter(item => !(item.kind === 'message' && item.usageOnly === true))
          expect(visible.some(item => item.id === 'a-step-2-silent')).toBe(false)

          const turnUsage = aggregateTurnUsageByTurn(folded).get('1')
          expect(turnUsage).toEqual({
            inputTokens: 4_000,
            cacheReadTokens: 135_000,
            cacheWriteTokens: 200,
            outputTokens: 1_800,
            reasoningTokens: 400,
            totalTokens: 141_000,
          })
          // High cache hit (cacheReadTokens 135,000 >> inputTokens 4,000): uncachedInput must NOT clamp to 0.
          const uncached = resolveUncachedInputTokens(turnUsage!)
          expect(uncached).toBe(4_000)
          expect(uncached + (turnUsage!.cacheReadTokens ?? 0) + (turnUsage!.cacheWriteTokens ?? 0) + turnUsage!.outputTokens)
            .toBe(turnUsage!.totalTokens)
        },
      },
      {
        name: 'does not synthesize totalTokens when any step omits it (V3 partial cache fields)',
        run: () => {
          const folded = foldHistory([
            event('assistant/message', 1, {
              turn: 1,
              step: 1,
              message: { id: 'v3-1', content: [{ type: 'text', text: 'step 1' }] },
              usage: { inputTokens: 4_200, outputTokens: 350, cacheReadTokens: 3_000 },
            }),
            event('assistant/message', 2, {
              turn: 1,
              step: 2,
              message: { id: 'v3-2', content: [{ type: 'text', text: 'step 2' }] },
              usage: { inputTokens: 1_000, outputTokens: 250, cacheReadTokens: 4_000, cacheWriteTokens: 0, totalTokens: 5_250 },
            }),
          ], 's1')
          const turnUsage = aggregateTurnUsageByTurn(folded).get('1')
          expect(turnUsage).toEqual({
            inputTokens: 5_200,
            outputTokens: 600,
            cacheReadTokens: 7_000,
            cacheWriteTokens: 0,
          })
          expect(turnUsage).not.toHaveProperty('totalTokens')
          expect(resolveUncachedInputTokens(turnUsage!)).toBe(5_200)
        },
      },
      {
        name: 'ACP inclusive inputTokens resolves uncachedInput so breakdown sums to totalTokens',
        run: () => {
          const sid = 'antigravity:s1'
          let items = applyCursorFrame([], sid, {
            streamId: 's',
            frame: {
              method: 'session/update',
              params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done' } } },
            },
          })
          items = applyCursorFrame(items, sid, {
            streamId: 's',
            frame: {
              method: 'session/update',
              params: {
                sessionId: 's1',
                update: {
                  sessionUpdate: 'prompt_completed',
                  stopReason: 'end_turn',
                  usage: { inputTokens: 120, outputTokens: 30, cachedReadTokens: 20, cachedWriteTokens: 5, thoughtTokens: 10, totalTokens: 150 },
                },
              },
            },
          })
          const msg = items.find((item): item is ChatMessage => item.kind === 'message' && item.role === 'assistant')
          expect(msg?.usage).toBeDefined()
          const uncached = resolveUncachedInputTokens(msg!.usage!)
          expect(uncached).toBe(95)
          expect(uncached + (msg!.usage!.cacheReadTokens ?? 0) + (msg!.usage!.cacheWriteTokens ?? 0) + msg!.usage!.outputTokens)
            .toBe(msg!.usage!.totalTokens)
        },
      },
    ])
  })
})
