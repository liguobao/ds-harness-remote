import { describe, expect, it } from 'vitest'
import { applyCursorFrame, foldAcpHistory, mergeAcpHistoryAndLive } from '../src/services/cursor'
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

  it('keeps the active ACP turn intact across trailing optimistic user messages and user_message_chunk', () => {
    const sid = 'antigravity:acp-turn'
    const frame = (update: Record<string, unknown>) => ({
      streamId: 's1',
      frame: { method: 'session/update', params: { sessionId: 'acp-turn', update } },
    })
    let messages = applyCursorFrame([], sid, frame({ sessionUpdate: 'tool_call', callId: 't1', name: 'bash' }))
    const turnId = messages[0]!.turn
    expect(turnId).toMatch(/^acp-live:/)

    // Append an optimistic local user message mid-turn (e.g. queued/steered)
    messages = [
      ...messages,
      { kind: 'message', id: 'local:queued-1', sessionId: sid, role: 'user', text: 'next prompt', createdAt: 10 },
    ]
    messages = applyCursorFrame(messages, sid, frame({ sessionUpdate: 'user_message_chunk', text: 'echoed' }))
    messages = applyCursorFrame(messages, sid, frame({ sessionUpdate: 'agent_message_chunk', text: 'Working...' }))
    expect(messages.at(-1)?.turn).toBe(turnId)

    messages = applyCursorFrame(messages, sid, frame({ sessionUpdate: 'prompt_completed', stopReason: 'end_turn' }))
    expect(messages[0]).toMatchObject({ kind: 'tool', turn: turnId, state: 'finished', turnEnd: { reason: 'completed' } })
    expect(messages.at(-1)).toMatchObject({ kind: 'message', role: 'assistant', text: 'Working...', turn: turnId, turnEnd: { reason: 'completed' } })

    // A subsequent turn after turnEnd must open a fresh acp-live turn.
    messages = applyCursorFrame(messages, sid, frame({ sessionUpdate: 'agent_message_chunk', text: 'Turn 2' }))
    expect(messages.at(-1)?.turn).not.toBe(turnId)
  })

  it('deduplicates ACP pure-text and image turns without collapsing independent identical assistant replies', () => {
    const sid = 'antigravity:acp-merge'
    const historyImg = { attachmentId: 'agy-image:1', sessionId: sid, uri: 'data:image/png;base64,iVBORw0KGgo=', mediaType: 'image/png', bytes: 8, width: 1, height: 1 }
    const localImg = { uri: 'file:///photo.png', name: 'photo.png' }

    // 1. Pure-text turn: [user, assistant] vs [local:user, cursor-assistant]
    const textHistory: ChatItem[] = [
      { kind: 'message', id: 'h-u1', sessionId: sid, role: 'user', text: '你好', createdAt: 1, nativeSeq: 0, nativeTime: 100 },
      { kind: 'message', id: 'h-a1', sessionId: sid, role: 'assistant', text: '你好！', createdAt: 2, nativeSeq: 1, nativeTime: 200 },
    ]
    const textLive: ChatItem[] = [
      { kind: 'message', id: 'local:1', sessionId: sid, role: 'user', text: '你好', createdAt: 10 },
      { kind: 'message', id: 'cursor-assistant:1', sessionId: sid, role: 'assistant', text: '你好！', createdAt: 20 },
    ]
    const mergedText = mergeAcpHistoryAndLive(textHistory, textLive)
    expect(mergedText).toHaveLength(2)
    expect(mergedText.map(i => (i.kind === 'message' ? i.text : ''))).toEqual(['你好', '你好！'])

    // 2. Image turn: preserves durable attachmentId image reference from history
    const imgHistory: ChatItem[] = [
      { kind: 'message', id: 'h-u2', sessionId: sid, role: 'user', text: '看图', images: [historyImg], createdAt: 1, nativeSeq: 0, nativeTime: 100 },
      { kind: 'message', id: 'h-a2', sessionId: sid, role: 'assistant', text: '收到', createdAt: 2, nativeSeq: 1, nativeTime: 200 },
    ]
    const imgLive: ChatItem[] = [
      { kind: 'message', id: 'local:2', sessionId: sid, role: 'user', text: '看图', images: [localImg], createdAt: 10 },
      { kind: 'message', id: 'cursor-assistant:2', sessionId: sid, role: 'assistant', text: '收到', createdAt: 20 },
    ]
    const mergedImg = mergeAcpHistoryAndLive(imgHistory, imgLive)
    expect(mergedImg).toHaveLength(2)
    expect(mergedImg[0]).toMatchObject({ role: 'user', text: '看图', images: [historyImg] })

    // 3. Single trailing local user prompt with image matching history user message
    const mergedPromptOnly = mergeAcpHistoryAndLive(
      [imgHistory[0]!],
      [imgLive[0]!, { kind: 'message', id: 'cursor-assistant-live', sessionId: sid, role: 'assistant', text: '分析中', createdAt: 30, streaming: true }],
    )
    expect(mergedPromptOnly).toHaveLength(2)
    expect(mergedPromptOnly[0]).toMatchObject({ role: 'user', images: [historyImg] })

    // 4. Independent identical assistant replies still do not collapse
    expect(mergeAcpHistoryAndLive(
      [{ kind: 'message', id: 'h-ok', sessionId: sid, role: 'assistant', text: 'OK', createdAt: 1 }],
      [{ kind: 'message', id: 'l-ok', sessionId: sid, role: 'assistant', text: 'OK', createdAt: 2 }],
    )).toHaveLength(2)
  })

  it('decodes structured ACP tool_call_update content, diffs, rawOutput text, and error flags', () => {
    const sid = 'antigravity:acp-tools'
    const frame = (update: Record<string, unknown>) => ({
      streamId: 's1',
      frame: { method: 'session/update', params: { sessionId: 'acp-tools', update } },
    })
    let messages = applyCursorFrame([], sid, frame({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-1',
      title: 'Edit file',
      status: 'in_progress',
      content: [],
    }))
    expect(messages[0]).toMatchObject({ kind: 'tool', state: 'running' })
    expect((messages[0] as { resultDetail?: unknown }).resultDetail).toBeUndefined()

    messages = applyCursorFrame(messages, sid, frame({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-1',
      status: 'completed',
      content: [
        { type: 'content', content: { type: 'text', text: 'Updated successfully' } },
        { type: 'diff', path: 'src/app.ts', oldText: 'old()', newText: 'new()' },
      ],
    }))
    expect(messages[0]).toMatchObject({
      kind: 'tool',
      state: 'finished',
      resultDetail: {
        text: 'Updated successfully\n\nFile: src/app.ts\n--- before\nold()\n+++ after\nnew()',
      },
    })

    messages = applyCursorFrame(messages, sid, frame({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-2',
      title: 'Run check',
      status: 'in_progress',
    }))
    messages = applyCursorFrame(messages, sid, frame({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-2',
      status: 'completed',
      rawOutput: { isError: true, content: [{ type: 'text', text: 'exit code 1' }] },
    }))
    expect(messages[1]).toMatchObject({
      kind: 'tool',
      state: 'failed',
      resultDetail: { text: 'exit code 1' },
    })
  })

  it('settles pending ACP approvals and questions when prompt_completed or prompt_failed arrives', async () => {
    await runScenarios([
      { name: 'prompt_completed end_turn', sessionUpdate: 'prompt_completed', stopReason: 'end_turn' },
      { name: 'prompt_completed cancelled', sessionUpdate: 'prompt_completed', stopReason: 'cancelled' },
      { name: 'prompt_failed', sessionUpdate: 'prompt_failed', stopReason: undefined },
    ].map(({ name, sessionUpdate, stopReason }) => ({
      name,
      run: () => {
        const sid = 'cursor:acp-pending'
        let messages = applyCursorFrame([], sid, {
          streamId: 's1',
          frame: {
            method: 'session/request_permission',
            params: { sessionId: 'acp-pending', requestHandle: 'req-1', toolName: 'bash', reason: 'ls' },
          },
        })
        messages = applyCursorFrame(messages, sid, {
          streamId: 's1',
          frame: {
            method: 'cursor/ask_question',
            params: {
              sessionId: 'acp-pending',
              requestHandle: 'q-1',
              questions: [{ id: 'q1', prompt: 'Proceed?' }],
            },
          },
        })
        messages = applyCursorFrame(messages, sid, {
          streamId: 's1',
          frame: {
            method: 'session/update',
            params: { sessionId: 'acp-pending', update: { sessionUpdate, stopReason } },
          },
        })
        expect(messages.find(item => item.kind === 'approval')).toMatchObject({ outcome: 'unavailable' })
        expect(messages.find(item => item.kind === 'question')).toMatchObject({ outcome: 'cancelled' })
      },
    })))
  })
})
