import { describe, expect, it } from 'vitest'
import type { ChatItem, MuxStreamFrame, NativeSessionEvent } from '../src/types'
import { applyMuxFrame, applyMuxFrameToMessages, foldHistory, sessionRunningForMuxFrame } from '../src/state/event-reducer'

function sessionEvent(event: Partial<NativeSessionEvent> & { type: string; data: Record<string, unknown> }): NativeSessionEvent {
  return {
    seq: 0,
    time: 1786000000000,
    ...event,
  } as NativeSessionEvent
}

function frame(rpcId: string, payload: { type: string } & Record<string, unknown>): MuxStreamFrame {
  return { rpcId, payload: payload as MuxStreamFrame['payload'] }
}

describe('remote mux frame reducer', () => {
  it('retains real system and injected context only when trajectory capture is requested', () => {
    const events = [sessionEvent({ type: 'system/message', seq: 1, data: { message: { id: 'sys', content: [{ type: 'text', text: 'system' }] } } }), sessionEvent({ type: 'user/message', seq: 2, data: { message: { id: 'ctx', source: { kind: 'plugin' }, content: [{ type: 'text', text: 'context' }] } } })]
    expect(foldHistory(events.map(event => ({ event })), 's1', true)).toMatchObject([{ role: 'system', context: false, text: 'system' }, { role: 'system', context: true, text: 'context' }])
  })
  it('retains native timestamp, exact fork sequence and usage without guessing missing totals', () => {
    const event = sessionEvent({ type: 'assistant/message', seq: 42, time: 123456, data: { turn: 3, step: 2, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 20 }, message: { id: 'm1', content: [{ type: 'text', text: 'answer' }] } } })
    expect(foldHistory([{ event }], 's1')[0]).toMatchObject({ createdAt: 123456, nativeTime: 123456, nativeSeq: 42, turn: '3', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 20 } })
    const missing = sessionEvent({ ...event, data: { ...event.data, usage: undefined } })
    expect(foldHistory([{ event: missing }], 's1')[0]).not.toHaveProperty('usage')
  })
  it('projects Harness turn lifecycle into the session running state', () => {
    const start = frame('', {
      type: 'session/event',
      sessionId: 's1',
      event: sessionEvent({ type: 'turn/start', data: {} }),
    })
    const end = frame('', {
      type: 'session/event',
      sessionId: 's1',
      event: sessionEvent({ type: 'turn/end', data: {} }),
    })

    expect(sessionRunningForMuxFrame(start)).toBe(true)
    expect(sessionRunningForMuxFrame(end)).toBe(false)
    const step = frame('', {
      type: 'session/event',
      sessionId: 's1',
      event: sessionEvent({ type: 'step/start', data: {} }),
    })
    expect(sessionRunningForMuxFrame(step)).toBeUndefined()
  })

  it('assembles streaming assistant chunks into a finalized message', () => {
    const chunk: MuxStreamFrame = frame('', {
      type: 'session/event',
      sessionId: 's1',
      event: sessionEvent({
        type: 'assistant/chunk',
        data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Hello ' } },
      }),
    })
    const chunkTwo: MuxStreamFrame = frame('', {
      type: 'session/event',
      sessionId: 's1',
      event: sessionEvent({
        type: 'assistant/chunk',
        data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Android' } },
      }),
    })
    const finalized: MuxStreamFrame = frame('', {
      type: 'session/event',
      sessionId: 's1',
      event: sessionEvent({
        type: 'assistant/message',
        data: {
          turn: 1, step: 1,
          message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Hello Android' }] },
        },
      }),
    })
    let items = applyMuxFrame([], chunk)
    items = applyMuxFrame(items, chunkTwo)
    expect(items).toMatchObject([{ kind: 'message', role: 'assistant', text: 'Hello Android', streaming: true }])
    items = applyMuxFrame(items, finalized)
    expect(items).toEqual([expect.objectContaining({ kind: 'message', id: 'm1', role: 'assistant', text: 'Hello Android' })])
    expect(items[0]).not.toHaveProperty('streaming')
  })

  it('keeps reasoning separate while it streams and after the answer is finalized', () => {
    const events = [
      sessionEvent({
        type: 'assistant/chunk',
        data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '先检查' } },
      }),
      sessionEvent({
        type: 'assistant/chunk',
        data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '状态。' } },
      }),
      sessionEvent({
        type: 'assistant/chunk',
        data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '已完成。' } },
      }),
    ]

    let items = foldHistory(events.map(event => ({ event })), 's1')
    expect(items).toEqual([expect.objectContaining({
      kind: 'message',
      text: '已完成。',
      reasoning: '先检查状态。',
      streaming: true,
      streamingPhase: 'text',
    })])

    items = applyMuxFrame(items, frame('', {
      type: 'session/event',
      sessionId: 's1',
      event: sessionEvent({
        type: 'assistant/message',
        data: {
          turn: 1, step: 1,
          message: { id: 'm-reasoning', role: 'assistant', content: [{ type: 'text', text: '已完成。' }] },
        },
      }),
    }))
    expect(items).toEqual([expect.objectContaining({
      id: 'm-reasoning',
      text: '已完成。',
      reasoning: '先检查状态。',
    })])
    expect(items[0]).not.toHaveProperty('streamingPhase')
  })

  it('does not render empty assistant messages around tool activity', () => {
    const empty = sessionEvent({
      type: 'assistant/message',
      data: { turn: 1, step: 1, message: { id: 'm-empty', role: 'assistant', content: [{ type: 'text', text: '\n  ' }, { type: 'tool-call', callId: 'c1' }] } },
    })
    const tool = sessionEvent({ type: 'tool/call', data: { callId: 'c1', name: 'bash' } })

    expect(foldHistory([{ event: empty }, { event: tool }], 's1')).toEqual([
      expect.objectContaining({ kind: 'tool', id: 'c1', toolName: 'bash' }),
    ])
  })

  it('does not create or finalize a Remote row for invisible streaming text', () => {
    const invisibleChunks = [' \n\t', '\u200B\u2060\uFEFF'].map(text => sessionEvent({
      type: 'assistant/chunk',
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text } },
    }))
    const emptyFinal = sessionEvent({
      type: 'assistant/message',
      data: { turn: 1, step: 1, message: { id: 'm-empty', role: 'assistant', content: [] } },
    })

    expect(foldHistory([...invisibleChunks, emptyFinal].map(event => ({ event })), 's1')).toEqual([])
  })

  it('keeps visible streamed text when the final assistant event has no text', () => {
    const visibleChunk = sessionEvent({
      type: 'assistant/chunk',
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '完成' } },
    })
    const emptyFinal = sessionEvent({
      type: 'assistant/message',
      data: { turn: 1, step: 1, message: { id: 'm1', role: 'assistant', content: [{ type: 'tool-call', callId: 'c1' }] } },
    })

    expect(foldHistory([{ event: visibleChunk }, { event: emptyFinal }], 's1')).toEqual([
      expect.objectContaining({ kind: 'message', id: 'm1', text: '完成' }),
    ])
  })

  it('adds user messages and tool activities from history events', () => {
    const events = [
      sessionEvent({
        type: 'user/message',
        data: { message: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'Check the repo' }], source: { kind: 'user' } } },
      }),
      sessionEvent({ type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: '{"command":"git status"}' } }),
    ]
    const items = foldHistory(events.map(event => ({ event })), 's1')
    expect(items).toMatchObject([
      { kind: 'message', id: 'u1', role: 'user', text: 'Check the repo' },
      { kind: 'tool', id: 'c1', toolName: 'bash', state: 'running' },
    ])
  })

  it('keeps image-only user prompts visible in history', () => {
    const event = sessionEvent({
      type: 'user/message',
      data: { message: { id: 'u-image', role: 'user', content: [{ type: 'image', attachmentId: 'attachment-1', name: 'diagram.png' }], source: { kind: 'user' } } },
    })

    expect(foldHistory([{ event }], 's1')).toEqual([
      expect.objectContaining({
        kind: 'message',
        id: 'u-image',
        role: 'user',
        text: '',
        images: [{ name: 'diagram.png' }],
      }),
    ])
  })

  it('renders safe data image blocks from native history', () => {
    const event = sessionEvent({
      type: 'user/message',
      data: {
        message: {
          id: 'u-data-image',
          role: 'user',
          content: [
            { type: 'image', url: 'data:image/png;base64,aW1hZ2U=', name: 'screen.png' },
            { type: 'image', url: 'https://example.test/not-allowed.png', name: 'external.png' },
          ],
          source: { kind: 'user' },
        },
      },
    })

    expect(foldHistory([{ event }], 's1')).toEqual([
      expect.objectContaining({
        kind: 'message',
        id: 'u-data-image',
        role: 'user',
        images: [{ uri: 'data:image/png;base64,aW1hZ2U=', name: 'screen.png' }],
      }),
    ])
  })

  it('hides plugin-injected system context from history and live conversation rows', () => {
    const injected = sessionEvent({
      type: 'user/message',
      data: {
        message: {
          id: 'system-context-1',
          role: 'user',
          content: [{ type: 'text', text: '<system-reminder>private instructions</system-reminder>' }],
          source: { kind: 'plugin', plugin: 'agent-instructions', form: 'instructions' },
        },
      },
    })

    expect(foldHistory([{ event: injected }], 's1')).toEqual([])
    expect(applyMuxFrame([], frame('', {
      type: 'session/event',
      sessionId: 's1',
      event: injected,
    }))).toEqual([])
  })

  it('merges a tool result using message.source.callId and uses native views', () => {
    const call = sessionEvent({
      type: 'tool/call',
      data: { callId: 'c1', name: 'run_code', arguments: '{"code":"long input"}' },
    })
    const result = sessionEvent({
      type: 'tool/result',
      data: { message: { source: { callId: 'c1' } }, content: [{ type: 'text', text: 'private output' }] },
    })
    const items = foldHistory([
      { event: call, view: { for: 'call', view: { title: '运行代码', description: '检查 PowerShell 脚本' } } },
      { event: result, view: { for: 'result', view: { title: '运行代码' } } },
    ], 's1')

    expect(items).toEqual([expect.objectContaining({
      kind: 'tool', id: 'c1', toolName: '运行代码', summary: '检查 PowerShell 脚本', state: 'finished',
    })])
  })

  it('keeps expandable terminal call and result details from native views', () => {
    const call = sessionEvent({
      type: 'tool/call',
      data: { callId: 'terminal-1', name: 'bash', arguments: '{"command":"pnpm test"}' },
    })
    const result = sessionEvent({
      type: 'tool/result',
      data: {
        message: {
          source: { callId: 'terminal-1' },
          content: [{ type: 'tool-result', isError: false, content: [{ type: 'text', text: 'fallback output' }] }],
        },
      },
    })
    const items = foldHistory([
      { event: call, view: { for: 'call', view: { card: 'terminal', title: 'pnpm test', cwd: '/workspace' } } },
      { event: result, view: { for: 'result', view: { card: 'terminal', output: '49 tests passed', exitCode: 0 } } },
    ], 's1')

    expect(items).toEqual([expect.objectContaining({
      kind: 'tool', id: 'terminal-1', toolName: 'pnpm test', state: 'finished',
      callDetail: { text: 'cwd: /workspace\n$ pnpm test', format: 'code' },
      resultDetail: { text: '49 tests passed\nexit: 0', format: 'code' },
    })])
  })

  it('falls back to the raw nested tool result when no result view is available', () => {
    const result = sessionEvent({
      type: 'tool/result',
      data: {
        message: {
          source: { callId: 'generic-1' },
          content: [{ type: 'tool-result', isError: true, content: [{ type: 'text', text: '**command failed**' }] }],
        },
      },
    })

    expect(foldHistory([{ event: result }], 's1')).toEqual([expect.objectContaining({
      kind: 'tool', id: 'generic-1', state: 'failed',
      resultDetail: { text: '**command failed**', format: 'markdown' },
    })])
  })

  it('reconciles an optimistic user message through the native prompt rpcId', () => {
    const optimistic: ChatItem = {
      kind: 'message',
      id: 'local-1',
      sessionId: 's1',
      role: 'user',
      text: 'Check the repo',
      requestRpcId: 'prompt-rpc-1',
      createdAt: 1,
    }
    const echoed = frame('push-1', {
      type: 'session/event',
      sessionId: 's1',
      event: sessionEvent({
        type: 'user/message',
        data: {
          message: {
            id: 'user-message-1',
            role: 'user',
            content: [{ type: 'text', text: 'Check the repo' }],
            source: { kind: 'user', rpcId: 'prompt-rpc-1' },
          },
        },
      }),
    })
    expect(applyMuxFrame([optimistic], echoed)).toEqual([
      expect.objectContaining({ id: 'user-message-1', text: 'Check the repo' }),
    ])
  })

  it('routes aggregated mux frames to their owning session', () => {
    const s2Approval = frame('rpc-approval-s2', {
      type: 'approval/requested',
      sessionId: 's2',
      approvalId: 'approval-s2',
      toolName: 'bash',
    })
    const messages = applyMuxFrameToMessages({ s1: [] }, s2Approval)
    expect(messages.s1).toEqual([])
    expect(messages.s2).toEqual([
      expect.objectContaining({ sessionId: 's2', frameRpcId: 'rpc-approval-s2' }),
    ])
  })

  it('adds and resolves approval requests with the frame rpcId', () => {
    const requested: MuxStreamFrame = frame('rpc-approval-1', {
      type: 'approval/requested',
      sessionId: 's1',
      approvalId: 'a1',
      toolName: 'bash',
      reason: 'Run npm test',
    })
    const resolved: MuxStreamFrame = frame('', {
      type: 'approval/resolved',
      sessionId: 's1',
      approvalId: 'a1',
      outcome: 'allowed-once',
    })
    let items = applyMuxFrame([], requested)
    expect(items).toMatchObject([{
      kind: 'approval', id: 'approval:a1', approvalId: 'a1', frameRpcId: 'rpc-approval-1', toolName: 'bash',
    }])
    items = applyMuxFrame(items, resolved)
    expect(items).toMatchObject([{ kind: 'approval', outcome: 'allowed-once' }])
  })

  it('adds and resolves question requests', () => {
    const requested: MuxStreamFrame = frame('rpc-question-1', {
      type: 'question/requested',
      sessionId: 's1',
      questions: [{ id: 'q1', question: 'Continue?', options: [{ label: 'Yes' }, { label: 'No' }] }],
    })
    const resolved: MuxStreamFrame = frame('', {
      type: 'question/resolved',
      sessionId: 's1',
      questionRpcId: 'rpc-question-1',
      outcome: 'answered',
    })
    let items = applyMuxFrame([], requested)
    expect(items).toMatchObject([{ kind: 'question', frameRpcId: 'rpc-question-1', questions: [{ id: 'q1' }] }])
    items = applyMuxFrame(items, resolved)
    expect(items).toMatchObject([{ kind: 'question', outcome: 'answered' }])
  })
})
