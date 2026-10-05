import { describe, expect, it } from 'vitest'
import { applyCursorFrame, foldAcpHistory } from '../src/services/cursor'

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
