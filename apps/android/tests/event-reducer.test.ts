import { runScenarios, scenarioName } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it } from 'vitest'
import type { ChatItem, MuxStreamFrame, NativeSessionEvent } from '../src/types'
import { applyMuxFrame, applyMuxFrameToMessages, foldHistory, sessionRunningForMuxFrame } from '../src/state/event-reducer'

let syntheticSeq = 0
function sessionEvent(event: Partial<NativeSessionEvent> & { type: string; data: Record<string, unknown> }): NativeSessionEvent {
  const seq = event.seq ?? syntheticSeq
  syntheticSeq = Math.max(syntheticSeq, seq + 1)
  return {
    seq,
    time: 1786000000000,
    ...event,
  } as NativeSessionEvent
}

function frame(rpcId: string, payload: { type: string } & Record<string, unknown>): MuxStreamFrame {
  return { rpcId, payload: payload as MuxStreamFrame['payload'] }
}

describe('remote mux frame reducer', () => {
  it('keeps continued timed questions answerable across turn end and updates the same card', () => {
    const id = 'timed-question:s1:c1'
    let items = applyMuxFrame([], frame(id, { type: 'question/requested', sessionId: 's1', callId: 'c1',
      questionState: 'open', deadline: 123, questions: [{ id: 'q1', question: 'Continue?' }] }))
    items = applyMuxFrame(items, frame(id, { type: 'question/requested', sessionId: 's1', callId: 'c1',
      questionState: 'continued', questions: [{ id: 'q1', question: 'Continue?' }] }))
    items = applyMuxFrame(items, frame('', { type: 'session/event', sessionId: 's1',
      event: sessionEvent({ type: 'turn/end', data: {} }) }))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'question', callId: 'c1', questionState: 'continued' })
    expect(items[0]).not.toHaveProperty('deadline')
    expect((items[0] as { outcome?: string }).outcome).toBeUndefined()
    items = applyMuxFrame(items, frame('', { type: 'question/resolved', sessionId: 's1', questionRpcId: id, outcome: 'answered' }))
    expect(items[0]).toMatchObject({ outcome: 'answered' })
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

  it('settles an older stream at turn/start without changing its reply anchor', () => {
    const original: ChatItem[] = [{ kind: 'message', id: 'old', sessionId: 's1', role: 'assistant',
      text: 'partial', streaming: true, turn: '3', createdAt: 1000, nativeSeq: 10, nativeTime: 1000 }]
    const start = sessionEvent({ type: 'turn/start', seq: 20, time: 2000, data: { turn: 4 } })
    expect(applyMuxFrame(original, frame('', { type: 'session/event', sessionId: 's1', event: start }))[0])
      .toMatchObject({ streaming: false, nativeSeq: 10, nativeTime: 1000, turn: '3' })
  })

  it('retains turn-end evidence without moving message and tool sequence anchors', async () => {
    const rows = [
      ['completed', 'completed'],
      ['aborted', 'stopped'],
      ['interrupted', 'stopped'],
      ['error', 'failed'],
      ['blocked', 'failed'],
      ['max-tokens', 'failed'],
      ['forked', 'failed'],
    ] as const
    await runScenarios(
      rows.map((row, index) => {
        const [kind, reason] = row
        return {
          name: scenarioName(
            'retains %s turn-end evidence without moving message and tool sequence anchors',
            row,
            index,
          ),
          run: () => {
            const events = [
              sessionEvent({
                type: 'assistant/message',
                seq: 10,
                time: 1000,
                data: {
                  turn: 3,
                  step: 1,
                  message: { id: 'reply', content: [{ type: 'text', text: 'Working' }] },
                },
              }),
              sessionEvent({
                type: 'tool/call',
                seq: 11,
                time: 1100,
                data: { turn: 3, name: 'bash', callId: 'call', arguments: '{"command":"true"}' },
              }),
              sessionEvent({
                type: 'assistant/message',
                seq: 12,
                time: 1200,
                data: {
                  turn: 4,
                  step: 1,
                  message: { id: 'other', content: [{ type: 'text', text: 'Another turn' }] },
                },
              }),
            ]
            const original = foldHistory(
              events.map((event) => ({ event })),
              's1',
            )
            const end = sessionEvent({
              type: 'turn/end',
              seq: 13,
              time: 1300,
              data: { turn: 3, reason: { kind } },
            })
            const live = applyMuxFrame(
              original,
              frame('', { type: 'session/event', sessionId: 's1', event: end }),
            )
            const history = foldHistory(
              [...events, end].map((event) => ({ event })),
              's1',
            )
            expect(live).toEqual(history)
            expect(live.slice(0, 2).map((item) => item.turnEnd)).toEqual([
              { reason, time: 1300 },
              { reason, time: 1300 },
            ])
            expect(live.map((item) => item.nativeSeq)).toEqual([10, 11, 12])
            expect(live.map((item) => item.nativeTime)).toEqual([1000, 1100, 1200])
            expect(live[2]).toBe(original[2])
            expect(live[1]).toMatchObject({ toolKey: 'bash', state: 'failed' })
          },
        }
      }),
    )
  })

  it('preserves failure evidence when a turn has no non-user activity', async () => {
    const prompt = sessionEvent({ type: 'user/message', seq: 1, time: 1001,
      data: { turn: 1, message: { id: 'prompt', source: { kind: 'user', rpcId: 'rpc' },
        content: [{ type: 'text', text: 'hello' }] } } })
    await runScenarios([
      { name: 'failure before any history', events: [], reason: { kind: 'error', error: { message: 'rate limited' } }, failed: true },
      { name: 'failure after the user prompt', events: [prompt], reason: { kind: 'error', error: { message: 'rate limited' } }, failed: true },
      { name: 'failure with hidden context', events: [prompt, sessionEvent({ type: 'developer/message', seq: 2,
        data: { turn: 1, message: { id: 'context', content: [{ type: 'text', text: 'context' }] } } })],
        reason: { kind: 'error', error: { message: 'rate limited' } }, failed: true },
      { name: 'completion after the user prompt', events: [prompt], reason: { kind: 'completed' }, failed: false },
      { name: 'user stop after the prompt', events: [prompt], reason: { kind: 'aborted' }, failed: false },
      { name: 'legacy end without failure evidence', events: [prompt], reason: undefined, failed: false },
    ].map(({ name, events, reason, failed }) => ({ name, run: () => {
      const end = sessionEvent({ type: 'turn/end', seq: 3, time: 1002, data: { turn: 1, reason } })
      const original = foldHistory(events.map(event => ({ event })), 's1', true)
      const live = applyMuxFrame(original, frame('', { type: 'session/event', sessionId: 's1', event: end }))
      expect(live).toEqual(foldHistory([...events, end].map(event => ({ event })), 's1', true))
      const activity = live.filter(item => item.kind !== 'message' || (item.role === 'assistant' && !item.context))
      expect(activity).toHaveLength(failed ? 1 : 0)
      if (failed) expect(activity[0]).toMatchObject({ kind: 'message', role: 'assistant', turn: '1',
        turnEnd: { reason: 'failed', time: 1002, detail: 'rate limited' } })
      // Repeated end frames must update the evidence without duplicating a row.
      expect(applyMuxFrame(live, frame('', { type: 'session/event', sessionId: 's1', event: end }))).toEqual(live)
      if (events.length > 0) expect(live[0]).toMatchObject({ id: 'prompt', nativeSeq: 1, nativeTime: 1001 })
    } })))
  })

  it('preserves assistant text and reasoning through stream finalization', async () => {
    await runScenarios([
      {
        name: 'assembles streaming assistant chunks into a finalized message',
        run: () => {
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
                turn: 1,
                step: 1,
                message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Hello Android' }] },
              },
            }),
          })
          let items = applyMuxFrame([], chunk)
          items = applyMuxFrame(items, chunkTwo)
          expect(items).toMatchObject([
            { kind: 'message', role: 'assistant', text: 'Hello Android', streaming: true },
          ])
          items = applyMuxFrame(items, finalized)
          expect(items).toEqual([
            expect.objectContaining({ kind: 'message', id: 'm1', role: 'assistant', text: 'Hello Android' }),
          ])
          expect(items[0]).not.toHaveProperty('streaming')
        },
      },
      {
        name: 'keeps reasoning separate while it streams and after the answer is finalized',
        run: () => {
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

          let items = foldHistory(
            events.map((event) => ({ event })),
            's1',
          )
          expect(items).toEqual([
            expect.objectContaining({
              kind: 'message',
              text: '已完成。',
              reasoning: '先检查状态。',
              streaming: true,
              streamingPhase: 'text',
            }),
          ])

          items = applyMuxFrame(
            items,
            frame('', {
              type: 'session/event',
              sessionId: 's1',
              event: sessionEvent({
                type: 'assistant/message',
                data: {
                  turn: 1,
                  step: 1,
                  message: {
                    id: 'm-reasoning',
                    role: 'assistant',
                    content: [{ type: 'text', text: '已完成。' }],
                  },
                },
              }),
            }),
          )
          expect(items).toEqual([
            expect.objectContaining({
              id: 'm-reasoning',
              text: '已完成。',
              reasoning: '先检查状态。',
            }),
          ])
          expect(items[0]).not.toHaveProperty('streamingPhase')
        },
      },
      {
        name: 'keeps visible streamed text when the final assistant event has no text',
        run: () => {
          const visibleChunk = sessionEvent({
            type: 'assistant/chunk',
            data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '完成' } },
          })
          const emptyFinal = sessionEvent({
            type: 'assistant/message',
            data: {
              turn: 1,
              step: 1,
              message: { id: 'm1', role: 'assistant', content: [{ type: 'tool-call', callId: 'c1' }] },
            },
          })

          expect(foldHistory([{ event: visibleChunk }, { event: emptyFinal }], 's1')).toEqual([
            expect.objectContaining({ kind: 'message', id: 'm1', text: '完成' }),
          ])
        },
      },
    ])
  }, 15000)

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

  it('projects safe user image blocks from native history', async () => {
    await runScenarios([
      {
        name: 'keeps image-only user prompts visible in history',
        run: () => {
          const event = sessionEvent({
            type: 'user/message',
            data: {
              message: {
                id: 'u-image',
                role: 'user',
                content: [{ type: 'image', attachmentId: 'attachment-1', name: 'diagram.png' }],
                source: { kind: 'user' },
              },
            },
          })

          expect(foldHistory([{ event }], 's1')).toEqual([
            expect.objectContaining({
              kind: 'message',
              id: 'u-image',
              role: 'user',
              text: '',
              images: [{ attachmentId: 'attachment-1', sessionId: 's1', name: 'diagram.png' }],
            }),
          ])
        },
      },
      {
        name: 'retains image-only assistant and nested tool results from native history',
        run: () => {
          const image = { type: 'image', attachment: { attachmentId: 'ai-image', name: 'result.png' } }
          const assistant = sessionEvent({ type: 'assistant/message', data: { message: { id: 'ai', content: [image] } } })
          const call = sessionEvent({ type: 'tool/call', data: { callId: 'c1', name: 'read_image' } })
          const result = sessionEvent({ type: 'tool/result', data: { callId: 'c1', message: {
            content: [{ type: 'tool-result', content: [image] }],
          } } })
          const rows = foldHistory([{ event: assistant }, { event: call }, { event: result }], 's1')
          expect(rows).toHaveLength(2)
          for (const row of rows) expect(row).toMatchObject({ images: [{ attachmentId: 'ai-image', sessionId: 's1', name: 'result.png' }] })
        },
      },
      {
        name: 'renders safe data image blocks from native history',
        run: () => {
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
        },
      },
    ])
  }, 10000)

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

  it('correlates and settles approval and question requests', async () => {
    await runScenarios([
      {
        name: 'adds and resolves approval requests with the frame rpcId',
        run: () => {
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
          expect(items).toMatchObject([
            {
              kind: 'approval',
              id: 'approval:a1',
              approvalId: 'a1',
              frameRpcId: 'rpc-approval-1',
              toolName: 'bash',
            },
          ])
          items = applyMuxFrame(items, resolved)
          expect(items).toMatchObject([{ kind: 'approval', outcome: 'allowed-once' }])
        },
      },
      {
        name: 'adds and resolves question requests',
        run: () => {
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
          expect(items).toMatchObject([
            { kind: 'question', frameRpcId: 'rpc-question-1', questions: [{ id: 'q1' }] },
          ])
          items = applyMuxFrame(items, resolved)
          expect(items).toMatchObject([{ kind: 'question', outcome: 'answered' }])
        },
      },
      {
        name: 'settles approval and question requests when their owning turn ends',
        run: () => {
          const tool = sessionEvent({
            type: 'tool/call',
            seq: 10,
            data: { turn: 3, name: 'bash', callId: 'call' },
          })
          const current = foldHistory([{ event: tool }], 's1')
          const approval = frame('rpc-approval-2', {
            type: 'approval/requested',
            sessionId: 's1',
            approvalId: 'a2',
            toolName: 'bash',
          })
          const question = frame('rpc-question-2', {
            type: 'question/requested',
            sessionId: 's1',
            questions: [{ id: 'q2', question: 'Continue?' }],
          })
          const end = frame('', {
            type: 'session/event',
            sessionId: 's1',
            event: sessionEvent({
              type: 'turn/end',
              seq: 13,
              data: { turn: 3, reason: { kind: 'aborted' } },
            }),
          })
          const items = applyMuxFrame(applyMuxFrame(applyMuxFrame(current, approval), question), end)
          expect(items).toMatchObject([
            { kind: 'tool', state: 'failed' },
            { kind: 'approval', turn: '3', outcome: 'unavailable' },
            { kind: 'question', turn: '3', outcome: 'cancelled' },
          ])
        },
      },
      {
        name: 'attaches background questions and approvals arriving before turn/start or tool/call to the active turn and revives re-emitted cards',
        run: () => {
          const closedTurn = foldHistory([
            { event: sessionEvent({ type: 'assistant/message', seq: 1, data: { turn: 1, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'Done' }] } } }) },
            { event: sessionEvent({ type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'completed' } } }) },
          ], 's1')
          const backgroundQuestion = frame('rpc-question-bg', {
            type: 'question/requested',
            sessionId: 's1',
            questions: [{ id: 'q-bg', question: 'Which branch?' }],
          })
          const backgroundApproval = frame('rpc-approval-bg', {
            type: 'approval/requested',
            sessionId: 's1',
            approvalId: 'app-bg',
            toolName: 'bash',
          })
          const withPending = applyMuxFrame(applyMuxFrame(closedTurn, backgroundQuestion), backgroundApproval)
          expect(withPending.find(item => item.kind === 'question')?.turn).toBeUndefined()
          expect(withPending.find(item => item.kind === 'question')?.outcome).toBeUndefined()
          expect(withPending.find(item => item.kind === 'approval')?.turn).toBeUndefined()
          expect(withPending.find(item => item.kind === 'approval')?.outcome).toBeUndefined()
          const turnStart = frame('', {
            type: 'session/event',
            sessionId: 's1',
            event: sessionEvent({ type: 'turn/start', seq: 3, data: { turn: 2 } }),
          })
          const afterStart = applyMuxFrame(withPending, turnStart)
          expect(afterStart.find(item => item.kind === 'question')).toMatchObject({
            kind: 'question',
            turn: '2',
          })
          expect(afterStart.find(item => item.kind === 'question')?.outcome).toBeUndefined()
          expect(afterStart.find(item => item.kind === 'approval')).toMatchObject({
            kind: 'approval',
            turn: '2',
          })
          expect(afterStart.find(item => item.kind === 'approval')?.outcome).toBeUndefined()
          // If settled prematurely, a re-emitted live request frame revives the card.
          const cancelled = applyMuxFrame(afterStart, frame('', {
            type: 'question/resolved',
            sessionId: 's1',
            questionRpcId: 'rpc-question-bg',
            outcome: 'cancelled',
          }))
          expect(cancelled.find(item => item.kind === 'question')?.outcome).toBe('cancelled')
          const revived = applyMuxFrame(cancelled, backgroundQuestion)
          expect(revived.find(item => item.kind === 'question')?.outcome).toBeUndefined()
        },
      },
    ])
  }, 15000)

})


describe('image attachment metadata tolerance', () => {
  it('reads image metadata from alternate attachment field names', () => {
    const event = sessionEvent({
      type: 'user/message',
      data: {
        message: {
          id: 'u-meta', role: 'user', source: { kind: 'user' },
          content: [{ type: 'image', attachment: {
            attachmentId: 'a1', mimeType: 'image/png', byteLength: 79, size: 79,
            imageWidth: 4, imageHeight: 2, fileName: 'diagram.png',
          } }],
        },
      },
    })
    expect(foldHistory([{ event }], 's1')).toEqual([
      expect.objectContaining({
        kind: 'message', id: 'u-meta', role: 'user',
        images: [{
          attachmentId: 'a1', sessionId: 's1', name: 'diagram.png',
          mediaType: 'image/png', bytes: 79, width: 4, height: 2,
        }],
      }),
    ])
  })
})
