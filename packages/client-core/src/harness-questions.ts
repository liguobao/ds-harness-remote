import type { HarnessClientFrame, HarnessQuestionAnswer } from './harness-alpha-client.js'
import { RemoteGatewayError, type RemoteGatewayStream, type RemoteTypertGateway } from './remote-gateway.js'

interface Question {
  sessionId: string
  callId: string
  questions: unknown[]
  state: 'open' | 'continued'
  eventId?: string
  controller?: AbortController
  stream?: RemoteGatewayStream
  timer?: ReturnType<typeof setTimeout>
  deadline?: number
  answering?: boolean
  answered?: boolean
  projected?: boolean
}

/** Official timed-question claims and durable projection recovery; no requests are replayed. */
export class HarnessQuestions {
  private readonly questions = new Map<string, Question>()
  private closed = false
  private readonly projectionSeqs = new Map<string, number>()

  constructor(
    private readonly gateway: RemoteTypertGateway,
    private readonly respondEvent: (id: string, outcome: { kind: 'result'; value?: unknown } | { kind: 'rejected'; error: unknown }) => Promise<void>,
    private readonly emit: (frame: HarnessClientFrame) => void,
  ) {}

  request(sessionId: string, eventId: string, request: Record<string, unknown>): boolean {
    const wait = record(request.wait)
    if (wait?.timed !== true || typeof wait.callId !== 'string') return false
    if (this.closed) return true
    const id = questionId(sessionId, wait.callId)
    const previous = this.questions.get(id)
    if (previous !== undefined) this.release(previous)
    const question: Question = { sessionId, callId: wait.callId, questions: Array.isArray(request.questions) ? request.questions : [], state: 'open', eventId }
    this.questions.set(id, question)
    void this.claim(id, question).catch(async () => {
      if (!this.current(id, question) || question.controller?.signal.aborted) return
      // Failed claim: reject the foreground request and let the Host settle its lifetime.
      await this.respondEvent(eventId, { kind: 'rejected', error: { name: 'UserQuestionError', code: 'ASK_ABORTED', message: 'The question claim could not be opened.' } }).catch(() => undefined)
      this.release(question)
    })
    return true
  }

  cancel(eventId: string): boolean {
    for (const [id, question] of this.questions) {
      if (question.eventId !== eventId) continue
      this.release(question)
      question.eventId = undefined
      // The authoritative projection determines whether this is continued or cancelled.
      return true
    }
    return false
  }

  projection(sessionId: string, value: unknown, seq?: number): void {
    if (this.closed) return
    const previous = this.projectionSeqs.get(sessionId)
    if (seq !== undefined && previous !== undefined && seq < previous) return
    const view = record(value)
    if (!Array.isArray(view?.active) || !Array.isArray(view?.settled)) return
    if (seq !== undefined) this.projectionSeqs.set(sessionId, seq)
    const active = new Set<string>()
    for (const row of view.active) {
      const item = record(row)
      if (typeof item?.callId !== 'string' || !Array.isArray(item.questions)
        || (item.state !== 'open' && item.state !== 'continued')) continue
      const id = questionId(sessionId, item.callId)
      active.add(id)
      let question = this.questions.get(id)
      if (question === undefined) {
        question = { sessionId, callId: item.callId, questions: item.questions, state: item.state }
        this.questions.set(id, question)
      }
      question.projected = true
      question.questions = item.questions
      question.state = item.state
      if (item.state === 'continued') {
        this.release(question)
        question.eventId = undefined
        this.publish(id, question)
      }
    }
    const settled = new Set(view.settled.flatMap(row => {
      const item = record(row)
      return typeof item?.callId === 'string' ? [questionId(sessionId, item.callId)] : []
    }))
    for (const [id, question] of this.questions) {
      if (question.sessionId !== sessionId || active.has(id)) continue
      // Event and control streams can interleave before the first active projection arrives.
      if (!question.projected && question.eventId !== undefined && !settled.has(id)) continue
      this.release(question)
      this.questions.delete(id)
      this.emit({ rpcId: '', payload: { type: 'question/resolved', sessionId, questionRpcId: id, outcome: settled.has(id) ? 'answered' : 'cancelled' } })
    }
  }

  async answer(id: string, sessionId: string, answer: HarnessQuestionAnswer): Promise<boolean> {
    const question = this.questions.get(id)
    if (question === undefined) return false
    if (question.sessionId !== sessionId || question.answering || question.answered) throw new RemoteGatewayError('PERMISSION_NOT_PENDING', 'That question is not available for this reply.')
    question.answering = true
    try {
      if (question.state === 'open') {
        if (question.eventId === undefined || question.deadline === undefined || Date.now() >= question.deadline) {
          throw new RemoteGatewayError('PERMISSION_NOT_PENDING', 'The foreground question has ended. Wait for the Host question state to refresh.')
        }
        await this.respondEvent(question.eventId, { kind: 'result', value: answer })
      } else {
        const response = await this.gateway.call('userQuestions/answer', { args: { agentId: sessionId, callId: question.callId, answer } })
        const result = record(response)
        if (response === false || (result?.ok === true && result.value === false)) throw new RemoteGatewayError('PERMISSION_NOT_PENDING', 'That question was already answered or expired.')
        if (result?.ok === false) throw new RemoteGatewayError('QUESTION_REPLY_REJECTED', 'The Host rejected the question reply.')
        if (response !== true && !(result?.ok === true && result.value === true)) throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid question reply result.')
      }
      question.answered = true
      this.release(question)
      this.emit({ rpcId: '', payload: { type: 'question/resolved', sessionId, questionRpcId: id, outcome: question.state === 'continued' ? 'queued' : 'answered' } })
      return true
    } finally {
      question.answering = false
    }
  }

  close(notifyRemote: boolean): void {
    this.closed = true
    for (const question of this.questions.values()) this.release(question, notifyRemote)
    this.questions.clear()
    this.projectionSeqs.clear()
  }

  private async claim(id: string, question: Question): Promise<void> {
    const controller = new AbortController()
    question.controller = controller
    const stream = await this.gateway.open('userQuestions/attachWait', { args: { agentId: question.sessionId, callId: question.callId } }, controller.signal)
    if (!this.current(id, question) || controller.signal.aborted) { await stream.close(false); return }
    question.stream = stream
    const iterator = stream[Symbol.asyncIterator]()
    const opening = await iterator.next()
    const remaining = record(opening.value)?.remainingMs
    if (opening.done || typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0 || remaining > 2_147_483_647) {
      this.release(question)
      return
    }
    if (!this.current(id, question) || controller.signal.aborted) return
    question.deadline = Date.now() + remaining
    this.publish(id, question)
    const expire = (): void => {
      if (!this.current(id, question) || question.eventId === undefined || question.answered) return
      // An in-flight reply owns settlement. A failed reply must still release the wait.
      if (question.answering) { question.timer = setTimeout(expire, 50); return }
      void this.respondEvent(question.eventId, { kind: 'rejected', error: { name: 'UserQuestionError', code: 'ASK_TIMED_OUT', message: 'The question answer window ended.' } }).finally(() => this.release(question)).catch(() => undefined)
    }
    question.timer = setTimeout(expire, remaining)
    await iterator.next()
    if (this.current(id, question)) this.release(question)
  }

  private current(id: string, question: Question): boolean { return !this.closed && this.questions.get(id) === question }
  private publish(id: string, question: Question): void {
    this.emit({ rpcId: id, payload: { type: 'question/requested', sessionId: question.sessionId, callId: question.callId, questions: question.questions, questionState: question.state, ...(question.deadline === undefined ? {} : { deadline: question.deadline }) } })
  }
  private release(question: Question, notifyRemote = true): void {
    clearTimeout(question.timer)
    question.timer = undefined
    question.deadline = undefined
    question.controller?.abort()
    void question.stream?.close(notifyRemote).catch(() => undefined)
    question.stream = undefined
  }
}

function record(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function questionId(sessionId: string, callId: string): string { return `timed-question:${JSON.stringify([sessionId, callId])}` }
