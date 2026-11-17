import type { AgentAcpFrameData, AgentAcpStreamClosedData } from '@dsh-remote/protocol'
import { acpImageLimits } from './image-content.js'
import { piToolResult } from './pi-tool-result.js'
import type { AcpCatalogBackend, AcpModelSelection } from './virtual-catalog.js'
import { acpBackendLabel } from './virtual-catalog.js'
import type {
  AcpClientLike,
  AcpPermissionPreset,
  AcpSessionState,
  FollowState,
  JsonRecord,
  NativeEvent,
  PendingApproval,
  PiTurnOutcome,
} from './virtual-contract.js'
import {
  AsyncValueQueue,
  extractSessionId,
  extractText,
  isRecord,
  isSurfaceEvent,
  optionalPositiveInteger,
  piPromptOutcome,
  piStreamOutcome,
  record,
  string,
  summarizeQuestions,
} from './virtual-contract.js'

/** Collaborates with one AcpVirtualHarness; never creates a second session or connection state. */
export interface AcpLiveProjectionContext {
  readonly lookupSession: (sessionId: string) => AcpSessionState | undefined
  readonly sessions: Map<string, AcpSessionState>
  readonly hydrateSession: (session: AcpSessionState) => Promise<void>
  readonly historyPage: (session: AcpSessionState, options?: { beforeSeq?: number; throughSeq?: number; limit?: number; }) => { assistantStream: { revision: number; }; activeTurnId?: string | undefined; header: { version: number; id: string; createdAt: number; cwd: string; isSeeded: boolean; }; cursor: number; nextTurn: number; records: { type: "event"; event: NativeEvent; }[]; hasMore: boolean; }
  readonly follows: Set<FollowState>
  readonly backend: AcpCatalogBackend
  readonly modelSelectionProjection: (sessionId: string) => { lastUsed: AcpModelSelection; next: AcpModelSelection; }
  readonly client: AcpClientLike
  readonly emitRemoteEvent: (event: string, args: unknown[]) => void
  readonly selectedModels: Map<string, AcpModelSelection>
  readonly publishProjection: (sessionId: string, key: string, value: unknown, seq?: number) => void
  readonly nextProjectionSeq: (sessionId?: string) => number
  readonly refreshSessionTitle: (session: AcpSessionState) => Promise<void>
  readonly applySessionTitle: (session: AcpSessionState, title: string) => void
  readonly publishWorkspaceBaseline: () => void
  readonly pendingApprovals: Map<string, PendingApproval>
  readonly emitApproval: (input: { eventId: string; agentId: string; request: JsonRecord; }) => void
  readonly modelSelection: (sessionId: string) => AcpModelSelection
  readonly permissionsProjection: (sessionId: string) => unknown
  readonly permissionSelection: (sessionId: string) => AcpPermissionPreset | undefined
  readonly rememberOpenedSession?: (sessionId: string) => void
  readonly syncSessionCache?: (session: AcpSessionState) => void
}

export class AcpLiveProjection {
  constructor(private readonly context: AcpLiveProjectionContext) {}

  private findFollow(sessionId: string): FollowState | undefined {
    for (const follow of this.context.follows) {
      if (follow.sessionId === sessionId) return follow
    }
    return undefined
  }

  private createFollowState(
    session: AcpSessionState,
    queue: AsyncValueQueue,
    hasConsumer: boolean,
    stepOpen: boolean,
  ): FollowState {
    return {
      sessionId: session.sessionId,
      acpSessionId: session.acpSessionId,
      queue,
      hasConsumer,
      nextSeq: session.events.length === 0 ? 0 : Math.max(...session.events.map(entry => entry.event.seq)) + 1,
      turn: Math.max(0, ...session.events.map(entry => (isRecord(entry.event.data) && typeof entry.event.data.turn === 'number' ? entry.event.data.turn : 0))),
      stepOpen,
      streamActive: false,
      assistantStreamRevision: 0,
      accumulatedText: '',
      accumulatedReasoning: '',
      activeToolCalls: new Set(),
      piToolOutputs: new Map(),
      piToolCalls: new Map(),
    }
  }

  private snapshotFrame(
    session: AcpSessionState,
    history: ReturnType<AcpLiveProjectionContext['historyPage']>,
    follow: FollowState,
  ) {
    const step = this.context.backend === 'pi' ? follow.piStep ?? 1 : 1
    const assistantStream = follow.assistantAttempt === undefined
      ? { revision: follow.assistantStreamRevision }
      : {
          revision: follow.assistantStreamRevision,
          activeAttempt: {
            attemptId: follow.assistantAttempt.attemptId,
            startedAfterSeq: follow.assistantAttempt.startedAfterSeq,
            turn: follow.turn,
            step,
            nextIndex: follow.assistantAttempt.nextIndex,
            stream: [...follow.assistantAttempt.stream],
          },
        }
    return {
      type: 'snapshot',
      header: history.header,
      cursor: history.cursor,
      records: history.records,
      hasMore: history.hasMore,
      projections: {
        asOfSeq: session.projectionSeq ?? -1,
        values: {
          title: session.title ?? acpBackendLabel(this.context.backend),
          sessionListMetadata: { blank: session.blank && session.events.length === 0, lastPromptAt: null },
          modelSelection: this.context.modelSelectionProjection(session.sessionId),
          permissions: this.context.permissionsProjection(session.sessionId),
          imageLimits: acpImageLimits(this.context.backend),
        },
      },
      assistantStream,
    }
  }

  private handleRemoteStreamClosed(
    session: AcpSessionState,
    follow: FollowState,
    reason: AgentAcpStreamClosedData['reason'],
  ): void {
    if (follow.closed) return
    session.running = false
    this.context.emitRemoteEvent('api-session/status', [session.sessionId, false])
    this.closeFollowAfterRemoteStreamClosed(follow, piStreamOutcome(reason), true)
  }

  async sessionFollow(request: JsonRecord, signal: AbortSignal): Promise<AsyncIterable<unknown>> {
    const requestedId = extractSessionId(request)
    const session = this.context.lookupSession(requestedId)
    if (session === undefined) throw new Error('The Session was not found.')
    const sessionId = session.sessionId
    await this.context.hydrateSession(session)
    this.context.rememberOpenedSession?.(sessionId)
    const history = this.context.historyPage(session, {
      limit: optionalPositiveInteger(request.maxMessages) ?? 50,
    })
    const queue = new AsyncValueQueue(signal)
    const existing = this.findFollow(sessionId)
    if (existing !== undefined) {
      const priorQueue = existing.queue
      existing.queue = queue
      existing.hasConsumer = true
      priorQueue.close()
      queue.push(this.snapshotFrame(session, history, existing))
      return queue.iterate(() => {
        if (existing.queue === queue) {
          existing.closed = true
          this.context.follows.delete(existing)
          void existing.close?.().catch(() => undefined)
        }
      })
    }
    const follow = this.createFollowState(session, queue, true, session.running)
    this.context.follows.add(follow)
    queue.push(this.snapshotFrame(session, history, follow))
    try {
      const stream = await this.context.client.openStream(
        session.acpSessionId,
        frame => this.acceptAcpFrame(follow, frame),
        closed => this.handleRemoteStreamClosed(session, follow, closed.reason),
        signal,
      )
      if (follow.closed || !this.context.follows.has(follow)) {
        await stream.close().catch(() => undefined)
      } else {
        follow.close = () => stream.close()
      }
    } catch (error) {
      this.context.follows.delete(follow)
      follow.closed = true
      follow.queue.close()
      throw error
    }
    return queue.iterate(() => {
      if (follow.queue === queue) {
        follow.closed = true
        this.context.follows.delete(follow)
        void follow.close?.().catch(() => undefined)
      }
    })
  }

  async ensureFollow(session: AcpSessionState): Promise<void> {
    if (this.findFollow(session.sessionId) !== undefined) return
    // Native UI opens session/follow; prompts before follow still work via Host stream open on demand.
    const controller = new AbortController()
    const queue = new AsyncValueQueue(controller.signal)
    const follow = this.createFollowState(session, queue, false, false)
    this.context.follows.add(follow)
    try {
      const stream = await this.context.client.openStream(
        session.acpSessionId,
        frame => this.acceptAcpFrame(follow, frame),
        closed => this.handleRemoteStreamClosed(session, follow, closed.reason),
      )
      if (follow.closed || !this.context.follows.has(follow)) {
        await stream.close().catch(() => undefined)
        return
      }
      follow.close = async () => {
        controller.abort()
        await stream.close()
      }
    } catch (error) {
      this.context.follows.delete(follow)
      follow.closed = true
      follow.queue.close()
      throw error
    }
  }

  acceptAcpFrame(follow: FollowState, frame: AgentAcpFrameData): void {
    const method = frame.frame.method
    const params = record(frame.frame.params)
    if (method === 'session/update') {
      this.acceptSessionUpdate(follow, params)
      return
    }
    if (follow.closed) return
    if (method === 'session/request_permission' || method === 'cursor/ask_question' || method === 'cursor/create_plan') {
      this.acceptApproval(follow, params, method)
    }
  }

  acceptSessionUpdate(follow: FollowState, params: JsonRecord): void {
    const update = isRecord(params.update) ? params.update : params
    const kind = string(update.sessionUpdate) ?? string(update.type)
    const session = this.context.sessions.get(follow.sessionId)
    if (kind === 'session_info_update') {
      if (session && params.sessionId === follow.acpSessionId && typeof update.title === 'string') {
        this.context.applySessionTitle(session, update.title)
      }
      return
    }
    if (follow.closed) return
    if (kind === 'model_selection' && isRecord(update.selected)
      && update.selected.provider === this.context.backend && typeof update.selected.model === 'string') {
      this.context.selectedModels.set(follow.sessionId, update.selected as unknown as AcpModelSelection)
      this.context.publishProjection(follow.sessionId, 'modelSelection', this.context.modelSelectionProjection(follow.sessionId), this.context.nextProjectionSeq(follow.sessionId))
      return
    }
    if (kind === 'agent_message_chunk' || kind === 'agent_message') {
      const text = extractText(update)
      if (text === undefined || text.length === 0) return
      this.appendAssistantDelta(follow, text)
      return
    }
    if (kind === 'tool_call' || kind === 'tool_call_update') {
      const toolName = string(update.title) ?? string(update.toolName) ?? string(update.name) ?? 'tool'
      const status = string(update.status)
      const callId = string(update.toolCallId) ?? string(update.callId) ?? toolName
      const terminal = status === 'completed' || status === 'failed'
      if (this.context.backend === 'pi') {
        const call = follow.piToolCalls.get(callId) ?? { name: toolName }
        if (typeof update.title === 'string') call.name = update.title
        if (update.rawInput !== undefined) call.input = update.rawInput
        follow.piToolCalls.set(callId, call)
        const output = piToolResult(update)
        const delta = record(record(update._meta).terminal_output).data
        if (typeof delta === 'string') {
          const buffered = follow.piToolOutputs.get(callId) ?? { text: '', overflow: false }
          if (!buffered.overflow) {
            if (buffered.text.length + delta.length > 1_048_576) { buffered.text = ''; buffered.overflow = true }
            else buffered.text += delta
          }
          follow.piToolOutputs.set(callId, buffered)
        }
        // Pi streams partial arguments while pending, then confirms final input
        // at execution start. Do not freeze a partial/empty call in the transcript.
        if (!terminal && status !== 'in_progress') return
        if (!follow.activeToolCalls.has(callId)) {
          this.ensurePiStep(follow, false)
          this.finishPiAssistant(follow)
          follow.piAfterTools = true
          this.pushEvent(follow, 'tool/call', {
            turn: follow.turn, step: follow.piStep ?? 1, callId, toolCallId: callId, name: call.name, toolName: call.name,
            arguments: typeof call.input === 'string' ? call.input
              : call.input != null ? JSON.stringify(call.input) : '{}',
            status: terminal ? status === 'failed' ? 'failed' : 'finished' : 'running',
          })
          follow.activeToolCalls.add(callId)
        }
        if (terminal) {
          const buffered = follow.piToolOutputs.get(callId)
          const content = buffered ? [{
            type: 'text', text: buffered.overflow
              ? '[Pi tool output exceeds the live preview limit; reload history to read the bounded persisted result.]' : buffered.text
          }]
            : output.content
          this.pushEvent(follow, 'tool/result', {
            turn: follow.turn, step: follow.piStep ?? 1, message: {
              id: `${callId}:result`, role: 'user', content: [{
                type: 'tool-result', toolCallId: callId,
                content, ...(output.isError ? { isError: true } : {})
              }], source: { kind: 'tool', callId },
            }
          })
          follow.piToolOutputs.delete(callId)
          follow.piToolCalls.delete(callId)
          follow.activeToolCalls.delete(callId)
        }
        if (session !== undefined) session.updatedAt = Date.now()
        return
      }
      if (kind === 'tool_call_update' && !terminal) return
      if (!terminal && follow.activeToolCalls.has(callId)) return
      if (!terminal || !follow.activeToolCalls.has(callId)) {
        this.pushEvent(follow, 'tool/call', {
          turn: follow.turn,
          step: 1,
          callId,
          name: toolName,
          arguments: typeof update.parameters === 'object' && update.parameters !== null
            ? JSON.stringify(update.parameters)
            : typeof update.rawInput === 'object' && update.rawInput !== null
              ? JSON.stringify(update.rawInput)
              : '{}',
          toolCallId: callId,
          toolName,
          status: status === 'completed' ? 'finished' : status === 'failed' ? 'failed' : 'running',
        })
      }
      if (terminal) {
        const output = piToolResult(update)
        const content = output.content.length > 0
          ? output.content
          : typeof update.rawOutput === 'string' && update.rawOutput.length > 0
            ? [{ type: 'text' as const, text: update.rawOutput }]
            : []
        this.pushEvent(follow, 'tool/result', {
          turn: follow.turn,
          step: 1,
          message: {
            id: `${callId}:result`,
            role: 'user',
            content: [{
              type: 'tool-result',
              toolCallId: callId,
              content,
              ...(output.isError ? { isError: true } : {}),
            }],
            source: { kind: 'tool', callId },
          },
        })
        follow.activeToolCalls.delete(callId)
      } else {
        follow.activeToolCalls.add(callId)
      }
      if (session !== undefined) session.updatedAt = Date.now()
      return
    }
    if (kind === 'agent_thought_chunk') {
      const text = extractText(update)
      if (text === undefined || text.length === 0) return
      this.appendReasoningDelta(follow, text)
      return
    }
    if (kind === 'prompt_completed' || kind === 'prompt_failed') {
      const hasLiveContent = follow.stepOpen || follow.streamActive
      if (!hasLiveContent && Array.isArray(update.catchUp)) {
        for (const item of update.catchUp) {
          if (!isRecord(item) || typeof item.method !== 'string') continue
          const params = isRecord(item.params) ? item.params : {}
          if (item.method === 'session/update') this.acceptSessionUpdate(follow, params)
        }
      }
      if (session !== undefined) {
        session.running = false
        session.updatedAt = Date.now()
        this.context.emitRemoteEvent('api-session/status', [follow.sessionId, false])
        this.context.publishWorkspaceBaseline()
        if (kind === 'prompt_completed') void this.context.refreshSessionTitle(session)
      }
      this.closeFollowAfterRemoteStreamClosed(follow, piPromptOutcome(kind, update))
    }
  }

  acceptApproval(follow: FollowState, params: JsonRecord, method: string): void {
    const requestHandle = string(params.requestHandle)
    if (requestHandle === undefined) return
    const currentPermission = this.context.permissionSelection(follow.sessionId)
    if (currentPermission === 'danger-full-access' && method === 'session/request_permission') {
      void this.context.client.respond(requestHandle, 'allow-once').catch(() => undefined)
      return
    }
    this.context.pendingApprovals.set(requestHandle, { requestHandle, sessionId: follow.sessionId })
    const toolName = method === 'cursor/create_plan'
      ? (string(params.name) ?? 'plan')
      : method === 'cursor/ask_question'
        ? (string(params.title) ?? 'question')
        : (string(params.toolName) ?? string(record(params.toolCall).title) ?? 'permission')
    const reason = method === 'cursor/create_plan'
      ? string(params.overview) ?? string(params.plan)
      : method === 'cursor/ask_question'
        ? summarizeQuestions(params)
        : string(params.reason) ?? string(record(record(params.toolCall).rawInput).message)
    this.context.emitApproval({
      eventId: requestHandle,
      agentId: follow.sessionId,
      request: {
        toolName,
        ...(reason === undefined ? {} : { reason }),
      },
    })
  }

  pushAssistantChunk(follow: FollowState, chunk: JsonRecord): void {
    let attempt = follow.assistantAttempt
    if (attempt === undefined) {
      attempt = {
        attemptId: this.context.backend === 'pi' ? `pi-attempt:${follow.sessionId}:${follow.turn}:${follow.piStep ?? 1}:${follow.nextSeq}`
          : `cursor-attempt:${follow.turn}:${follow.nextSeq}`,
        startedAfterSeq: follow.nextSeq - 1,
        nextIndex: 0,
        stream: [],
      }
      follow.assistantAttempt = attempt
      follow.assistantStreamRevision += 1
      follow.queue.push({
        type: 'assistant-stream',
        frame: {
          type: 'start',
          attemptId: attempt.attemptId,
          revision: follow.assistantStreamRevision,
          startedAfterSeq: attempt.startedAfterSeq,
          turn: follow.turn,
          step: this.context.backend === 'pi' ? follow.piStep ?? 1 : 1,
        },
      })
    }
    const time = Date.now()
    const index = attempt.nextIndex++
    // Durable streams use AssistantStreamRecord, unlike the timed chunks in
    // the live feed. Without this discriminator the native reader treats a
    // raw chunk as a packed run and throws while settling the conversation.
    attempt.stream.push({ type: 'chunk', time, chunk })
    follow.assistantStreamRevision += 1
    follow.queue.push({
      type: 'assistant-stream',
      frame: {
        type: 'chunk',
        attemptId: attempt.attemptId,
        revision: follow.assistantStreamRevision,
        index,
        time,
        chunk,
      },
    })
  }

  endAssistantAttempt(
    follow: FollowState,
    outcome: { kind: 'abandoned' } | { kind: 'committed'; eventType: 'assistant/message'; seq: number },
  ): void {
    const attempt = follow.assistantAttempt
    if (attempt === undefined) return
    follow.assistantAttempt = undefined
    follow.assistantStreamRevision += 1
    follow.queue.push({
      type: 'assistant-stream',
      frame: {
        type: 'end',
        attemptId: attempt.attemptId,
        revision: follow.assistantStreamRevision,
        index: attempt.nextIndex,
        outcome,
      },
    })
  }

  appendAssistantDelta(follow: FollowState, delta: string): void {
    if (this.context.backend === 'pi') this.ensurePiStep(follow, true)
    if (!follow.stepOpen) {
      follow.turn += 1
      follow.stepOpen = true
      this.pushEvent(follow, 'turn/start', { turn: follow.turn })
      this.pushEvent(follow, 'step/start', { turn: follow.turn, step: 1 })
    }
    if (follow.blockIndex === undefined) {
      follow.blockIndex = (follow.reasoningBlockIndex ?? -1) + 1
      follow.streamActive = true
      this.pushAssistantChunk(follow, { type: 'block-start', index: follow.blockIndex, blockType: 'text' })
    }
    follow.accumulatedText += delta
    this.pushAssistantChunk(follow, { type: 'text-delta', index: follow.blockIndex, text: delta })
  }

  appendReasoningDelta(follow: FollowState, delta: string): void {
    if (this.context.backend === 'pi') {
      this.ensurePiStep(follow, true)
      follow.piReasoning = (follow.piReasoning ?? '') + delta
    }
    follow.accumulatedReasoning = (follow.accumulatedReasoning ?? '') + delta
    if (!follow.stepOpen) {
      follow.turn += 1
      follow.stepOpen = true
      this.pushEvent(follow, 'turn/start', { turn: follow.turn })
      this.pushEvent(follow, 'step/start', { turn: follow.turn, step: 1 })
    }
    if (follow.reasoningBlockIndex === undefined) {
      follow.reasoningBlockIndex = (follow.blockIndex ?? -1) + 1
      follow.streamActive = true
      this.pushAssistantChunk(follow, { type: 'block-start', index: follow.reasoningBlockIndex, blockType: 'reasoning' })
    }
    this.pushAssistantChunk(follow, { type: 'reasoning-delta', index: follow.reasoningBlockIndex, text: delta })
  }

  /** Pi model steps settle before tools; a tool round does not end the turn. */
  ensurePiStep(follow: FollowState, advanceAfterTools: boolean): void {
    if (!follow.stepOpen) {
      follow.turn++
      follow.piStep = 1
      follow.stepOpen = true
      this.pushEvent(follow, 'turn/start', { turn: follow.turn })
      this.pushEvent(follow, 'step/start', { turn: follow.turn, step: 1 })
    } else if (advanceAfterTools && follow.piAfterTools) {
      this.pushEvent(follow, 'step/end', { turn: follow.turn, step: follow.piStep ?? 1 })
      follow.piStep = (follow.piStep ?? 1) + 1
      this.pushEvent(follow, 'step/start', { turn: follow.turn, step: follow.piStep })
    }
    if (advanceAfterTools) follow.piAfterTools = false
  }

  private finishReason(outcome: PiTurnOutcome): JsonRecord {
    if (outcome.kind === 'error') return { kind: 'error', failure: outcome.error }
    if (outcome.kind === 'aborted') {
      return {
        kind: 'aborted',
        failure: { code: 'ABORTED', message: `${acpBackendLabel(this.context.backend)} reply interrupted.` },
      }
    }
    return { kind: outcome.kind === 'max-tokens' ? 'max-tokens' : 'stop' }
  }

  finishPiAssistant(follow: FollowState, outcome: PiTurnOutcome = { kind: 'completed' }): void {
    if (!follow.streamActive) return
    const isPi = this.context.backend === 'pi'
    const step = isPi ? follow.piStep ?? 1 : 1
    const reasoningText = follow.accumulatedReasoning ?? follow.piReasoning ?? ''
    const blocks = [
      { index: follow.reasoningBlockIndex, type: 'reasoning', text: reasoningText },
      { index: follow.blockIndex, type: 'text', text: follow.accumulatedText },
    ].filter((block): block is { index: number; type: string; text: string } => block.index !== undefined)
      .sort((a, b) => a.index - b.index)
    for (const { index, type, text } of blocks) {
      this.pushAssistantChunk(follow, { type: 'block-end', index, block: { type, text } })
    }
    this.pushAssistantChunk(follow, { type: 'finish', reason: this.finishReason(outcome) })
    const selection = this.context.modelSelection(follow.sessionId)
    const seq = this.pushEvent(follow, 'assistant/message', {
      turn: follow.turn,
      step,
      message: {
        id: isPi ? `${follow.sessionId}:${follow.turn}:${step}` : `${follow.sessionId}:${follow.turn}`,
        role: 'assistant',
        content: blocks.map(({ type, text }) => ({ type, text })),
        source: { kind: 'model', provider: selection.provider, model: selection.model },
      },
      stream: follow.assistantAttempt?.stream ?? [],
    })
    this.endAssistantAttempt(follow, { kind: 'committed', eventType: 'assistant/message', seq })
    follow.streamActive = false
    follow.blockIndex = undefined
    follow.reasoningBlockIndex = undefined
    follow.accumulatedText = ''
    follow.accumulatedReasoning = ''
    follow.piReasoning = ''
  }

  closeFollowAfterRemoteStreamClosed(
    follow: FollowState,
    outcome: PiTurnOutcome = { kind: 'completed' },
    remoteClosed = false,
  ): void {
    if (follow.closed) return
    const session = this.context.sessions.get(follow.sessionId)
    if (session !== undefined) session.running = false
    const isPi = this.context.backend === 'pi'
    const step = isPi ? follow.piStep ?? 1 : 1
    this.finishPiAssistant(follow, outcome)
    if (follow.stepOpen) {
      this.pushEvent(follow, 'step/end', { turn: follow.turn, step })
      this.pushEvent(follow, 'turn/end', { turn: follow.turn, reason: outcome })
    }
    follow.stepOpen = false
    if (isPi) {
      follow.piStep = 1
      follow.piAfterTools = false
    }
    follow.piToolOutputs.clear()
    follow.piToolCalls.clear()
    follow.activeToolCalls.clear()
    if (session !== undefined) this.context.syncSessionCache?.(session)
    if (remoteClosed || !follow.hasConsumer) {
      follow.closed = true
      this.context.follows.delete(follow)
      follow.queue.close()
      void follow.close?.().catch(() => undefined)
    }
  }

  pushEvent(follow: FollowState, type: string, data: unknown): number {
    const session = this.context.sessions.get(follow.sessionId)
    const seq = session !== undefined ? session.events.length : follow.nextSeq++
    const event: NativeEvent = {
      type,
      seq,
      time: Date.now(),
      data,
      ...(isSurfaceEvent(type) ? { surfaceOp: 'append' as const } : {}),
    }
    if (session !== undefined) {
      session.events.push({ type: 'event', event })
      this.context.syncSessionCache?.(session)
    }
    for (const f of this.context.follows) {
      if (f.sessionId === follow.sessionId) {
        f.queue.push({ type: 'event', event })
        f.nextSeq = seq + 1
      }
    }
    return seq
  }
}
