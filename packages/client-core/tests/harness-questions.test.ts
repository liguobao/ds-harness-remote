import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessQuestions } from '../src/harness-questions.js'
import type { RemoteTypertGateway } from '../src/remote-gateway.js'

function setup(remainingMs = 1000) {
  const emit = vi.fn()
  const respond = vi.fn(async () => undefined)
  const call = vi.fn(async () => true)
  const close = vi.fn(async () => undefined)
  const open = vi.fn(async (_endpoint: string, _payload: unknown, signal: AbortSignal) => ({
    close,
    async *[Symbol.asyncIterator]() {
      yield { remainingMs }
      await new Promise<void>(resolve => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => resolve(), { once: true })
      })
    },
  }))
  const gateway = { call, open } as unknown as RemoteTypertGateway
  const questions = new HarnessQuestions(gateway, respond, emit)
  return { questions, call, open, close, respond, emit }
}
const rows = [{ id: 'q1', question: 'Continue?', options: [{ label: 'yes' }] }]
const request = { questions: rows, wait: { callId: 'call1', timed: true } }
const answer = { answers: [{ id: 'q1', selected: ['yes'] }] }
const projection = (state: 'open' | 'continued') => ({ active: [{ callId: 'call1', questions: rows, state }], settled: [] })
afterEach(() => vi.useRealTimers())

describe('Harness timed question lifetime', () => {
  it('claims before publishing and answers the original event inside the window', async () => {
    const s = setup()
    try {
      expect(s.questions.request('s1', 'event1', request)).toBe(true)
      s.questions.projection('s1', { active: [], settled: [] }, 1)
      await vi.waitFor(() => expect(s.emit).toHaveBeenCalled())
      expect(s.open).toHaveBeenCalledWith('userQuestions/attachWait', { args: { agentId: 's1', callId: 'call1' } }, expect.any(AbortSignal))
      const id = s.emit.mock.calls[0]![0].rpcId
      expect(s.emit.mock.calls[0]![0].payload).toMatchObject({ questionState: 'open', callId: 'call1', deadline: expect.any(Number) })
      await expect(s.questions.answer(id, 'another-session', answer)).rejects.toMatchObject({ code: 'PERMISSION_NOT_PENDING' })
      await expect(s.questions.answer(id, 's1', answer)).resolves.toBe(true)
      expect(s.respond).toHaveBeenCalledWith('event1', { kind: 'result', value: answer })
      expect(s.call).not.toHaveBeenCalled()
      await expect(s.questions.answer(id, 's1', answer)).rejects.toMatchObject({ code: 'PERMISSION_NOT_PENDING' })
    } finally { s.questions.close(false) }
  })

  it('times out exactly once and uses the Host continued projection for late replies', async () => {
    vi.useFakeTimers()
    const s = setup()
    try {
      s.questions.request('s1', 'event1', request)
      await vi.advanceTimersByTimeAsync(0)
      const id = s.emit.mock.calls[0]![0].rpcId
      await vi.advanceTimersByTimeAsync(1000)
      expect(s.respond).toHaveBeenCalledWith('event1', { kind: 'rejected', error: expect.objectContaining({ name: 'UserQuestionError', code: 'ASK_TIMED_OUT' }) })
      await vi.advanceTimersByTimeAsync(1000)
      expect(s.respond).toHaveBeenCalledTimes(1)
      await expect(s.questions.answer(id, 's1', answer)).rejects.toMatchObject({ code: 'PERMISSION_NOT_PENDING' })
      s.questions.cancel('event1')
      s.questions.projection('s1', projection('continued'))
      expect(s.emit.mock.calls.at(-1)![0]).toMatchObject({ rpcId: id, payload: { questionState: 'continued' } })
      await s.questions.answer(id, 's1', answer)
      expect(s.call).toHaveBeenCalledWith('userQuestions/answer', { args: { agentId: 's1', callId: 'call1', answer } })
      expect(s.emit.mock.calls.at(-1)![0].payload).toMatchObject({ outcome: 'queued' })
      s.questions.projection('s1', { active: [], settled: [{ callId: 'call1', answers: answer.answers }] })
      expect(s.emit.mock.calls.at(-1)![0].payload).toMatchObject({ outcome: 'answered' })
    } finally { s.questions.close(false) }
  })

  it('restores continued questions after reconnect and respects Host rejection and settlement', async () => {
    const s = setup()
    try {
      s.questions.projection('s1', projection('continued'), 10)
      const id = s.emit.mock.calls[0]![0].rpcId
      s.call.mockResolvedValueOnce(false)
      await expect(s.questions.answer(id, 's1', answer)).rejects.toMatchObject({ code: 'PERMISSION_NOT_PENDING' })
      s.questions.projection('s1', { active: [], settled: [{ callId: 'call1', answers: answer.answers }] }, 11)
      expect(s.emit.mock.calls.at(-1)![0].payload).toMatchObject({ questionRpcId: id, outcome: 'answered' })
      s.questions.projection('s1', projection('continued'), 9)
      expect(s.emit.mock.calls.at(-1)![0].payload).toMatchObject({ outcome: 'answered' })
      expect(s.open).not.toHaveBeenCalled()
    } finally { s.questions.close(false) }
  })

  it('releases claims on cancellation and disconnect without replaying answers', async () => {
    vi.useFakeTimers()
    const s = setup()
    s.questions.request('s1', 'event1', request)
    await vi.advanceTimersByTimeAsync(0)
    expect(s.questions.cancel('event1')).toBe(true)
    s.questions.close(false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(s.respond).not.toHaveBeenCalled()
    expect(s.call).not.toHaveBeenCalled()
    expect(s.close).toHaveBeenCalled()
  })

  it('leaves indefinite previous-RC questions on the existing event path', () => {
    const s = setup()
    expect(s.questions.request('s1', 'event1', { questions: rows })).toBe(false)
    expect(s.open).not.toHaveBeenCalled()
    s.questions.close(false)
  })
})
