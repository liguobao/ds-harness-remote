import { describe, expect, it } from 'vitest'
import { applyCursorFrame } from '../src/services/cursor'

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
})
