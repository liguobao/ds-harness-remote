import { describe, expect, it } from 'vitest'
import { computeStreamingSignature, LATEST_EDGE_PX } from '../src/state/message-helpers'
import type { ApprovalActivity, ChatMessage, QuestionActivity, ToolActivity } from '../src/types'

describe('streaming auto-scroll and smart scroll mechanics', () => {
  it('returns empty signature for empty message list', () => {
    expect(computeStreamingSignature([])).toBe('')
  })

  it('detects streaming text delta increments on the last message', () => {
    const baseMessage: ChatMessage = {
      id: 'msg-1',
      sessionId: 'session-1',
      createdAt: 1000,
      kind: 'message',
      role: 'assistant',
      text: 'Hello',
      images: [],
    }

    const sig1 = computeStreamingSignature([baseMessage])
    expect(sig1).toBe('msg-1:5:0:::0:0:0')

    const streamedChunk1: ChatMessage = {
      ...baseMessage,
      text: 'Hello world',
    }
    const sig2 = computeStreamingSignature([streamedChunk1])
    expect(sig2).toBe('msg-1:11:0:::0:0:0')
    expect(sig2).not.toBe(sig1)

    const streamedChunk2: ChatMessage = {
      ...baseMessage,
      text: 'Hello world, how can I help you today?',
    }
    const sig3 = computeStreamingSignature([streamedChunk2])
    expect(sig3).toBe('msg-1:38:0:::0:0:0')
    expect(sig3).not.toBe(sig2)
  })

  it('detects streaming reasoning (thinking) increments', () => {
    const baseMessage: ChatMessage = {
      id: 'msg-think-1',
      sessionId: 'session-1',
      createdAt: 1000,
      kind: 'message',
      role: 'assistant',
      text: '',
      reasoning: 'Analyzing question',
      images: [],
    }

    const sig1 = computeStreamingSignature([baseMessage])
    expect(sig1).toBe('msg-think-1:0:18:::0:0:0')

    const baseMessageWithMoreReasoning: ChatMessage = {
      ...baseMessage,
      reasoning: 'Analyzing question carefully step by step...',
    }
    const sig2 = computeStreamingSignature([baseMessageWithMoreReasoning])
    expect(sig2).toBe('msg-think-1:0:44:::0:0:0')
    expect(sig2).not.toBe(sig1)
  })

  it('detects stream completion turnEnd state', () => {
    const streamingMessage: ChatMessage = {
      id: 'msg-final-1',
      sessionId: 'session-1',
      createdAt: 1000,
      kind: 'message',
      role: 'assistant',
      text: 'Complete answer.',
      images: [],
    }
    const sigStreaming = computeStreamingSignature([streamingMessage])

    const finishedMessage: ChatMessage = {
      ...streamingMessage,
      turnEnd: { reason: 'completed', time: 2000 },
    }
    const sigFinished = computeStreamingSignature([finishedMessage])

    expect(sigFinished).toBe('msg-final-1:16:0:completed::0:0:0')
    expect(sigFinished).not.toBe(sigStreaming)
  })

  it('detects message streaming flag, image appends and sendError without text growth', () => {
    const baseMessage: ChatMessage = {
      id: 'msg-facet-1',
      sessionId: 'session-1',
      createdAt: 1000,
      kind: 'message',
      role: 'assistant',
      text: 'Done',
      images: [],
    }
    const sigBase = computeStreamingSignature([baseMessage])

    const sigStreaming = computeStreamingSignature([{ ...baseMessage, streaming: true }])
    expect(sigStreaming).not.toBe(sigBase)

    const sigWithImage = computeStreamingSignature([
      { ...baseMessage, images: [{ uri: 'file:///tmp/a.png', name: 'a.png' }] },
    ])
    expect(sigWithImage).not.toBe(sigBase)

    const sigSendError = computeStreamingSignature([{ ...baseMessage, sendError: 'network unreachable' }])
    expect(sigSendError).not.toBe(sigBase)
  })

  it('detects in-place tool state transitions on the last item', () => {
    const baseTool: ToolActivity = {
      id: 'tool-1',
      sessionId: 'session-1',
      createdAt: 1000,
      kind: 'tool',
      toolName: 'Bash',
      state: 'running',
    }
    const sigRunning = computeStreamingSignature([baseTool])
    expect(sigRunning).toBe('tool-1:tool:running:0:0:0')

    const sigFailed = computeStreamingSignature([{ ...baseTool, state: 'failed' }])
    expect(sigFailed).toBe('tool-1:tool:failed:0:0:0')
    expect(sigFailed).not.toBe(sigRunning)

    // Running tools stream into callDetail without a state transition.
    const sigProgress = computeStreamingSignature([
      { ...baseTool, callDetail: { text: 'progress line', format: 'code' } },
    ])
    expect(sigProgress).not.toBe(sigRunning)
  })

  it('detects approval outcome and question state/outcome transitions', () => {
    const baseApproval: ApprovalActivity = {
      id: 'approval-1',
      sessionId: 'session-1',
      createdAt: 1000,
      kind: 'approval',
      approvalId: 'approval-1',
      toolName: 'Bash',
    }
    const sigOpen = computeStreamingSignature([baseApproval])
    const sigAllowed = computeStreamingSignature([{ ...baseApproval, outcome: 'allowed-once' }])
    expect(sigAllowed).not.toBe(sigOpen)

    const baseQuestion: QuestionActivity = {
      id: 'question-1',
      sessionId: 'session-1',
      createdAt: 1000,
      kind: 'question',
      questions: [],
      questionState: 'open',
    }
    const sigQuestionOpen = computeStreamingSignature([baseQuestion])
    const sigContinued = computeStreamingSignature([{ ...baseQuestion, questionState: 'continued' }])
    expect(sigContinued).not.toBe(sigQuestionOpen)
    const sigAnswered = computeStreamingSignature([{ ...baseQuestion, outcome: 'answered' }])
    expect(sigAnswered).not.toBe(sigContinued)
  })

  it('ignores deltas that happen only on earlier messages', () => {
    const earlierMessage: ChatMessage = {
      id: 'msg-user-1',
      sessionId: 'session-1',
      createdAt: 1000,
      kind: 'message',
      role: 'user',
      text: 'Original prompt',
      images: [],
    }
    const assistantMessage: ChatMessage = {
      id: 'msg-asst-1',
      sessionId: 'session-1',
      createdAt: 1001,
      kind: 'message',
      role: 'assistant',
      text: 'Working...',
      images: [],
    }

    const sig1 = computeStreamingSignature([earlierMessage, assistantMessage])

    const updatedEarlierMessage: ChatMessage = {
      ...earlierMessage,
      text: 'Original prompt edited',
    }
    const sig2 = computeStreamingSignature([updatedEarlierMessage, assistantMessage])

    // Signature of latest message does not change if earlier messages change
    expect(sig2).toBe(sig1)
  })

  it('shares LATEST_EDGE_PX threshold (80px) for pin-to-bottom and smart scroll', () => {
    expect(LATEST_EDGE_PX).toBe(80)

    const isAtBottom = (distanceFromEnd: number) => distanceFromEnd <= LATEST_EDGE_PX

    expect(isAtBottom(0)).toBe(true)
    expect(isAtBottom(40)).toBe(true)
    expect(isAtBottom(80)).toBe(true)
    expect(isAtBottom(81)).toBe(false)
    expect(isAtBottom(500)).toBe(false)
  })
})
