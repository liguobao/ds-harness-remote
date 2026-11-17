import { describe, expect, it } from 'vitest'
import { applyCursorFrame, foldAcpHistory } from '../src/services/cursor'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import type { ChatItem } from '../src/types'

function updateFrame(sessionUpdate: string, text: string) {
  return {
    streamId: 's1',
    frame: {
      method: 'session/update',
      params: {
        sessionId: 'acp-1',
        update: {
          sessionUpdate,
          content: { type: 'text', text },
        },
      },
    },
  }
}

function completedFrame() {
  return {
    streamId: 's1',
    frame: {
      method: 'session/update',
      params: {
        sessionId: 'acp-1',
        update: { sessionUpdate: 'prompt_completed', stopReason: 'end_turn' },
      },
    },
  }
}

describe('applyCursorFrame', () => {
  it('preserves ACP prompt activity order, terminal evidence and isolation during live and catch-up delivery', async () => {
    await runScenarios(['live', 'catch-up'].flatMap(delivery => [
      ['prompt_completed', 'end_turn', 'completed'],
      ['prompt_completed', 'cancelled', 'stopped'],
      ['prompt_failed', undefined, 'failed'],
    ].map(([sessionUpdate, stopReason, reason]) => ({
      name: `${delivery}: ${reason}`,
      run: () => {
        const sessionId = 'antigravity:acp-1'
        const frame = (update: Record<string, unknown>) => ({ streamId: 's1', frame: {
          method: 'session/update', params: { sessionId: 'acp-1', update },
        } })
        let messages: ChatItem[] = []
        const updates = [
          { sessionUpdate: 'agent_thought_chunk', text: 'Inspect first' },
          { sessionUpdate: 'tool_call', callId: '1', name: 'view_file', parameters: { path: '/host/file' } },
          { sessionUpdate: 'tool_call_update', callId: '1', output: 'contents' },
          { sessionUpdate: 'agent_message_chunk', text: 'Found the file.' },
          { sessionUpdate: 'tool_call', callId: '2', name: 'run_command' },
          { sessionUpdate: 'agent_message_chunk', text: 'Finished.' },
        ]
        if (delivery === 'live') {
          for (const update of updates) messages = applyCursorFrame(messages, sessionId, frame(update))
          expect(messages.every(item => item.turnEnd === undefined)).toBe(true)
        }
        messages = applyCursorFrame(messages, sessionId, frame({ sessionUpdate, stopReason,
          ...(delivery === 'catch-up' ? { catchUp: updates.map(update => frame(update).frame) } : {}),
        }))
        expect(new Set(messages.map(item => item.turn)).size).toBe(1)
        expect(messages[0]?.turn).toMatch(/^acp-live:/)
        expect(messages.every(item => item.turnEnd?.reason === reason)).toBe(true)
        expect(messages.map(item => item.kind === 'tool' ? item.toolName : item.kind === 'message' ? item.text : '')).toEqual([
          '', 'view_file', 'Found the file.', 'run_command', 'Finished.',
        ])
        expect(messages[1]).toMatchObject({ toolKey: 'view_file', state: 'finished', resultDetail: { text: 'contents' } })
        expect(messages[0]).toMatchObject({ reasoning: 'Inspect first', streaming: false })
        expect(messages[3]).toMatchObject({ state: reason === 'completed' ? 'finished' : 'failed' })
        const previous = messages
        messages = applyCursorFrame(messages, sessionId, frame({ sessionUpdate: 'tool_call', callId: '1', name: 'view_file' }))
        expect(messages.at(-1)?.turn).not.toBe(previous[0]?.turn)
        expect(messages.at(-1)?.id).not.toBe(previous[1]?.id)
        expect(messages.slice(0, -1)).toEqual(previous)
        const other = applyCursorFrame([], 'antigravity:other', frame({ sessionUpdate: 'tool_call', callId: '1', name: 'view_file' }))
        expect(other[0]?.turn).not.toBe(messages.at(-1)?.turn)
      },
    }))))
  })

  it('finalizes each prompt into its own assistant bubble', () => {
    let messages = applyCursorFrame([], 'cursor:acp-1', updateFrame('agent_message_chunk', '第一轮'))
    messages = applyCursorFrame(messages, 'cursor:acp-1', completedFrame())
    messages = applyCursorFrame(messages, 'cursor:acp-1', updateFrame('agent_message_chunk', '第二轮'))
    messages = applyCursorFrame(messages, 'cursor:acp-1', completedFrame())

    const assistants = messages.filter(item => item.kind === 'message' && item.role === 'assistant')
    expect(assistants).toHaveLength(2)
    expect(assistants.map(item => item.kind === 'message' ? item.text : '')).toEqual(['第一轮', '第二轮'])
    expect(assistants.every(item => item.kind === 'message' && item.id !== 'cursor-assistant-live')).toBe(true)
    expect(new Set(assistants.map(item => item.id)).size).toBe(2)
  })

  it('folds Antigravity transcript history into user and assistant messages', () => {
    const messages = foldAcpHistory([
      {
        type: 'event',
        event: {
          type: 'user/message',
          seq: 0,
          time: 100,
          data: {
            id: 'user:1',
            role: 'user',
            content: [{ type: 'text', text: '请检查项目' }],
            source: { kind: 'user' },
          },
        },
      },
      {
        type: 'event',
        event: {
          type: 'assistant/message',
          seq: 1,
          time: 200,
          data: {
            turn: 1,
            message: {
              id: 'assistant:1',
              role: 'assistant',
              content: [
                { type: 'reasoning', text: '先读取目录' },
                { type: 'text', text: '项目结构正常。' },
              ],
            },
          },
        },
      },
    ], 'antigravity:conv-1')

    expect(messages).toMatchObject([
      { kind: 'message', role: 'user', text: '请检查项目', nativeSeq: 0, nativeTime: 100 },
      { kind: 'message', role: 'assistant', text: '项目结构正常。', reasoning: '先读取目录', turn: '1', nativeSeq: 1, nativeTime: 200 },
    ])
  })
})
